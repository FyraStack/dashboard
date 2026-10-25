// Project-owned custom images, imported from a user-supplied URL.
//
// Flow: the Worker checks the URL (https, public DNS, qcow2 header, size), then
// Proxmox `download-url` pulls it into a dedicated import storage. PVE 9 runs
// `qemu-img info -f qcow2` on the download with its untrusted-image checks
// (no backing files, no external data files) before accepting it.
//
// SSRF: Proxmox fetches the URL from inside our network and wget follows
// redirects, so the Worker-side checks can't be airtight (DNS rebinding,
// redirects to internal hosts). What keeps this safe is that only qcow2 is
// accepted: an internal HTTP response is not a valid qcow2, so PVE rejects it
// and nothing ends up readable from a VM. Failure messages are also generic so
// the import can't be used to probe internal ports.
//
// Isolation:
// - Every row carries `owner_project_id`; all reads/writes are scoped by it.
// - Proxmox filenames are generated from the image id, never from user input, and
//   live in a dedicated storage that platform image tooling ignores.

import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { Address4, Address6 } from 'ip-address';
import { getBackend } from '#lib/server/backends/index.js';
import { config } from '#lib/server/config.js';
import type { Database } from '#lib/server/db/index.js';
import { baseImages, vms } from '#lib/server/db/schema.js';
import { ulid } from '#lib/server/id.js';

export type BaseImageRow = typeof baseImages.$inferSelect;

const limits = config.customImages;
const VOLUME_FILENAME_PATTERN = /^stack-custom-([0-9a-z]{26})\.qcow2$/;
const FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const HEADER_BYTES = 512;
const SHA256_PATTERN = /^(?:sha256:)?([0-9a-f]{64})$/i;
const SHA512_PATTERN = /^(?:sha512:)?([0-9a-f]{128})$/i;
const CONTENT_RANGE_TOTAL = /\/(\d+)$/;
const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const ALPHA_TLD = /^[a-z]{2,63}$/;
const TRAILING_DOT = /\.$/;
const CHECKSUM_FAILURE = /checksum|hash/i;
const NESTED_IMAGE_FAILURE = /backing file|data-file|extents/i;
const FORMAT_FAILURE = /qemu-img|qcow2|format/i;

export class ImageValidationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ImageValidationError';
	}
}

function formatGiB(bytes: number) {
	return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GiB`;
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

// URL checks

const BLOCKED_HOST_SUFFIXES = [
	'.local',
	'.localhost',
	'.internal',
	'.intranet',
	'.lan',
	'.home',
	'.corp',
	'.home.arpa',
	'.arpa',
	'.ts.net',
	'.example',
	'.invalid',
	'.test'
];

const BLOCKED_V4 = [
	'0.0.0.0/8',
	'10.0.0.0/8',
	'100.64.0.0/10',
	'127.0.0.0/8',
	'169.254.0.0/16',
	'172.16.0.0/12',
	'192.0.0.0/24',
	'192.0.2.0/24',
	'192.88.99.0/24',
	'192.168.0.0/16',
	'198.18.0.0/15',
	'198.51.100.0/24',
	'203.0.113.0/24',
	'224.0.0.0/4',
	'240.0.0.0/4'
].map((cidr) => new Address4(cidr));

const BLOCKED_V6 = [
	'::/128',
	'::1/128',
	'100::/64',
	'2001::/23',
	'2001:db8::/32',
	'2002::/16',
	'fc00::/7',
	'fe80::/10',
	'fec0::/10',
	'ff00::/8'
].map((cidr) => new Address6(cidr));

// Prefixes that embed an IPv4 address in the low 32 bits (NAT64, v4-mapped).
const EMBEDDED_V4_PREFIXES = ['64:ff9b::/96', '64:ff9b:1::/48', '::ffff:0:0/96'].map(
	(cidr) => new Address6(cidr)
);

function extraBlockedPrefixes() {
	return limits.blockedPrefixes.map((cidr) =>
		Address4.isValid(cidr) ? new Address4(cidr) : new Address6(cidr)
	);
}

export function isPublicAddress(address: string): boolean {
	const extra = extraBlockedPrefixes();
	if (Address4.isValid(address)) {
		const v4 = new Address4(address);
		return ![...BLOCKED_V4, ...extra.filter((p) => p instanceof Address4)].some((net) =>
			v4.isInSubnet(net)
		);
	}
	if (Address6.isValid(address)) {
		const v6 = new Address6(address);
		if (EMBEDDED_V4_PREFIXES.some((net) => v6.isInSubnet(net))) {
			return isPublicAddress(v6.to4().correctForm());
		}
		return ![...BLOCKED_V6, ...extra.filter((p) => p instanceof Address6)].some((net) =>
			v6.isInSubnet(net)
		);
	}
	return false;
}

/** Syntactic checks on an import URL. Throws ImageValidationError. */
export function parseImportUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch (err) {
		throw new ImageValidationError('Enter a valid URL', { cause: err });
	}
	if (url.protocol !== 'https:') {
		throw new ImageValidationError('Image URLs must use https://');
	}
	if (url.username || url.password) {
		throw new ImageValidationError('Image URLs cannot contain credentials');
	}
	if (url.port && url.port !== '443') {
		throw new ImageValidationError('Image URLs must use the default https port');
	}
	const host = url.hostname.toLowerCase().replace(TRAILING_DOT, '');
	if (host.startsWith('[') || Address4.isValid(host)) {
		throw new ImageValidationError('Use a hostname instead of an IP address');
	}
	const labels = host.split('.');
	if (
		labels.length < 2 ||
		!labels.every((label) => HOSTNAME_LABEL.test(label)) ||
		!ALPHA_TLD.test(labels.at(-1) ?? '') ||
		host === 'localhost' ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
	) {
		throw new ImageValidationError('Image URLs must point to a public hostname');
	}
	if (url.toString().length > 2048) {
		throw new ImageValidationError('Image URL is too long');
	}
	return url;
}

interface DohAnswer {
	data: string;
	type: number;
}

async function resolveHost(hostname: string): Promise<string[]> {
	const lookups = await Promise.all(
		['A', 'AAAA'].map(async (type) => {
			const res = await fetch(
				`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
				{
					headers: { accept: 'application/dns-json' },
					signal: AbortSignal.timeout(5000)
				}
			);
			if (!res.ok) {
				throw new ImageValidationError('Could not resolve the image host');
			}
			const body = (await res.json()) as { Status: number; Answer?: DohAnswer[] };
			return (body.Answer ?? [])
				.filter((answer) => answer.type === 1 || answer.type === 28)
				.map((answer) => answer.data);
		})
	);
	return lookups.flat();
}

/** Reject hosts that resolve (publicly) to private or reserved space. */
async function assertPublicHost(url: URL) {
	const addresses = await resolveHost(url.hostname);
	if (addresses.length === 0) {
		throw new ImageValidationError('The image host does not resolve');
	}
	if (!addresses.every(isPublicAddress)) {
		throw new ImageValidationError('Image URLs must point to a public host');
	}
}

// qcow2 header inspection

export interface ImageHeaderInfo {
	virtualSizeBytes: number;
}

const QCOW2_MAGIC = 0x51_46_49_fb; // "QFI\xfb"
const QCOW2_INCOMPAT_CORRUPT_BIT = 1n;
const QCOW2_INCOMPAT_EXTERNAL_DATA_FILE_BIT = 2n;

function hasBit(value: bigint, bit: bigint) {
	return (value / 2n ** bit) % 2n === 1n;
}

/**
 * Validate a qcow2 header. Proxmox re-checks the real download; this exists to
 * give users a fast, specific error before anything is queued.
 */
export function inspectImageHeader(bytes: Uint8Array): ImageHeaderInfo {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (!(bytes.length >= 4 && view.getUint32(0) === QCOW2_MAGIC)) {
		throw new ImageValidationError(
			'The URL does not serve a qcow2 image. Convert it with `qemu-img convert -O qcow2` and make sure the link downloads the file directly.'
		);
	}
	if (bytes.length < 104) {
		throw new ImageValidationError('qcow2 header is truncated');
	}
	const version = view.getUint32(4);
	if (version !== 2 && version !== 3) {
		throw new ImageValidationError(`Unsupported qcow2 version ${version}`);
	}
	if (view.getBigUint64(8) !== 0n || view.getUint32(16) !== 0) {
		throw new ImageValidationError(
			'qcow2 images with a backing file are not allowed. Flatten it with `qemu-img convert -O qcow2` first.'
		);
	}
	if (view.getUint32(32) !== 0) {
		throw new ImageValidationError('Encrypted qcow2 images are not supported');
	}
	if (version === 3) {
		const incompatible = view.getBigUint64(72);
		if (hasBit(incompatible, QCOW2_INCOMPAT_EXTERNAL_DATA_FILE_BIT)) {
			throw new ImageValidationError('qcow2 images with an external data file are not allowed');
		}
		if (hasBit(incompatible, QCOW2_INCOMPAT_CORRUPT_BIT)) {
			throw new ImageValidationError('qcow2 image is marked as corrupt');
		}
	}
	const virtualSize = view.getBigUint64(24);
	if (virtualSize === 0n || virtualSize > BigInt(limits.maxVirtualSizeBytes)) {
		throw new ImageValidationError(
			`qcow2 virtual size must be between 1 byte and ${formatGiB(limits.maxVirtualSizeBytes)}`
		);
	}
	return { virtualSizeBytes: Number(virtualSize) };
}

// Pre-flight fetch

interface PreflightResult {
	header: ImageHeaderInfo;
	sizeBytes: number | null;
	url: URL;
}

async function readPrefix(body: ReadableStream<Uint8Array>, length: number) {
	const reader = body.getReader();
	const buffer = new Uint8Array(length);
	let offset = 0;
	try {
		while (offset < length) {
			// biome-ignore lint/performance/noAwaitInLoops: reading a stream is sequential
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const take = Math.min(value.length, length - offset);
			buffer.set(value.subarray(0, take), offset);
			offset += take;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return buffer.subarray(0, offset);
}

function totalSizeFrom(res: Response): number | null {
	const range = res.headers.get('content-range');
	const match = range ? CONTENT_RANGE_TOTAL.exec(range) : null;
	if (match) {
		return Number(match[1]);
	}
	const length = res.headers.get('content-length');
	return res.status === 200 && length ? Number(length) : null;
}

/**
 * Fetch the start of the image from the Worker, following redirects ourselves so
 * every hop gets the same URL checks. Returns the final URL for Proxmox.
 */
async function preflightImageUrl(raw: string): Promise<PreflightResult> {
	let url = parseImportUrl(raw);
	for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
		// biome-ignore lint/performance/noAwaitInLoops: redirect hops are sequential
		await assertPublicHost(url);
		let res: Response;
		try {
			res = await fetch(url, {
				headers: { range: `bytes=0-${HEADER_BYTES - 1}` },
				redirect: 'manual',
				signal: AbortSignal.timeout(limits.urlCheckTimeoutMs)
			});
		} catch (err) {
			throw new ImageValidationError('Could not connect to the image URL', { cause: err });
		}

		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			const location = res.headers.get('location');
			if (!location) {
				throw new ImageValidationError('The image URL redirected without a location');
			}
			url = parseImportUrl(new URL(location, url).toString());
			continue;
		}
		if (!((res.status === 200 || res.status === 206) && res.body)) {
			await res.body?.cancel();
			throw new ImageValidationError(`The image URL returned HTTP ${res.status}`);
		}

		const sizeBytes = totalSizeFrom(res);
		const header = inspectImageHeader(await readPrefix(res.body, HEADER_BYTES));
		if (sizeBytes !== null && sizeBytes > limits.maxImageBytes) {
			throw new ImageValidationError(
				`Images can be at most ${formatGiB(limits.maxImageBytes)} (this one is ${formatGiB(sizeBytes)})`
			);
		}
		return { url, sizeBytes, header };
	}
	throw new ImageValidationError('The image URL redirected too many times');
}

// Helpers

export function customImageVolumeFilename(imageId: string) {
	return `stack-custom-${imageId.toLowerCase()}.qcow2`;
}

export function isCustomImage(image: Pick<BaseImageRow, 'ownerProjectId'>) {
	return image.ownerProjectId !== null;
}

/** Whether a project may boot from this image. Platform images are visible to everyone. */
export function canProjectUseImage(
	image: Pick<BaseImageRow, 'ownerProjectId'>,
	projectId: string
): boolean {
	return image.ownerProjectId === null || image.ownerProjectId === projectId;
}

function projectUsageQuery(
	db: Pick<Database, 'select'>,
	projectId: string,
	excludeImageId?: string
) {
	return db
		.select({
			count: sql<number>`count(*)::int`,
			bytes: sql<number>`coalesce(sum(${baseImages.sizeBytes}), 0)::bigint`
		})
		.from(baseImages)
		.where(
			excludeImageId
				? and(eq(baseImages.ownerProjectId, projectId), ne(baseImages.id, excludeImageId))
				: eq(baseImages.ownerProjectId, projectId)
		);
}

export async function getProjectImageUsage(db: Database, projectId: string) {
	const [usage] = await projectUsageQuery(db, projectId);
	return { count: Number(usage?.count ?? 0), bytes: Number(usage?.bytes ?? 0) };
}

export function customImageLimits() {
	return {
		maxImagesPerProject: limits.maxImagesPerProject,
		maxImageBytes: limits.maxImageBytes,
		maxProjectBytes: limits.maxProjectBytes
	};
}

export function parseChecksum(raw: string | undefined) {
	const value = raw?.trim();
	if (!value) {
		return null;
	}
	const sha256 = SHA256_PATTERN.exec(value);
	if (sha256) {
		return { algorithm: 'sha256' as const, value: sha256[1].toLowerCase() };
	}
	const sha512 = SHA512_PATTERN.exec(value);
	if (sha512) {
		return { algorithm: 'sha512' as const, value: sha512[1].toLowerCase() };
	}
	error(400, 'Checksum must be a SHA-256 or SHA-512 hex digest');
}

export function validateImageMetadata(input: {
	name?: string;
	version?: string;
	description?: string;
}) {
	const name = input.name?.trim();
	if (name !== undefined && (name.length === 0 || name.length > 64)) {
		error(400, 'Image name must be between 1 and 64 characters');
	}
	const version = input.version?.trim();
	if (version !== undefined && version.length > 32) {
		error(400, 'Version must be at most 32 characters');
	}
	const description = input.description?.trim();
	if (description !== undefined && description.length > 500) {
		error(400, 'Description must be at most 500 characters');
	}
	return { name, version, description };
}

/**
 * Turn a Proxmox task exit status into something safe to show users. Raw
 * messages can reveal how internal hosts respond, so only image-format and
 * checksum problems are passed through.
 */
function describeImportFailure(exitstatus: string | undefined) {
	const status = exitstatus ?? '';
	if (CHECKSUM_FAILURE.test(status)) {
		return 'The downloaded file did not match the checksum';
	}
	if (NESTED_IMAGE_FAILURE.test(status)) {
		return 'qcow2 images with a backing file or external data file are not allowed';
	}
	if (FORMAT_FAILURE.test(status)) {
		return 'The downloaded file is not a valid qcow2 image';
	}
	return 'Download failed. Make sure the URL is publicly reachable and downloads the image directly.';
}

async function markFailed(db: Database, image: Pick<BaseImageRow, 'id'>, message: string) {
	await db
		.update(baseImages)
		.set({ status: 'failed', statusError: message, updatedAt: Date.now() })
		.where(eq(baseImages.id, image.id));
}

// Import lifecycle

export interface CreateImportInput {
	checksum?: string;
	description: string;
	name: string;
	projectId: string;
	secureBoot: boolean;
	url: string;
	userId: string;
	version: string;
}

export async function createCustomImageImport(db: Database, input: CreateImportInput) {
	const { name, version, description } = validateImageMetadata(input);
	const checksum = parseChecksum(input.checksum);

	let preflight: PreflightResult;
	try {
		preflight = await preflightImageUrl(input.url);
	} catch (err) {
		if (err instanceof ImageValidationError) {
			error(400, err.message);
		}
		throw err;
	}

	const imageId = ulid();
	await db.transaction(async (tx) => {
		// Serialize quota checks per project so concurrent imports can't both squeeze in.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`custom-images:${input.projectId}`}))`
		);
		const [usage] = await projectUsageQuery(tx, input.projectId);
		const count = Number(usage?.count ?? 0);
		const bytes = Number(usage?.bytes ?? 0);
		if (count >= limits.maxImagesPerProject) {
			error(
				409,
				`Projects can have at most ${limits.maxImagesPerProject} custom images. Delete one first.`
			);
		}
		if (bytes + (preflight.sizeBytes ?? 0) > limits.maxProjectBytes) {
			error(
				409,
				`This image would exceed the ${formatGiB(limits.maxProjectBytes)} custom image storage limit`
			);
		}

		await tx.insert(baseImages).values({
			id: imageId,
			ownerProjectId: input.projectId,
			createdByUserId: input.userId,
			status: 'importing',
			filePath: '',
			name: name ?? '',
			version: version ?? '',
			description: description ?? '',
			isOfficial: false,
			imageType: 'qcow2',
			secureBoot: input.secureBoot,
			isa: 'x86',
			sizeBytes: preflight.sizeBytes,
			virtualSizeBytes: preflight.header.virtualSizeBytes,
			sourceUrl: input.url.trim()
		});
	});

	try {
		const task = await getBackend('proxmox').importCustomImage({
			filename: customImageVolumeFilename(imageId),
			url: preflight.url.toString(),
			checksum: checksum?.value,
			checksumAlgorithm: checksum?.algorithm
		});
		await db
			.update(baseImages)
			.set({
				filePath: task.volid,
				importNode: task.node,
				importUpid: task.upid,
				updatedAt: Date.now()
			})
			.where(eq(baseImages.id, imageId));
	} catch (err) {
		console.error(`Failed to start import for image ${imageId}`, err);
		await markFailed(db, { id: imageId }, 'Failed to start the import');
		error(502, 'Failed to start the import. Try again in a moment.');
	}

	return { imageId };
}

/** Check limits against what Proxmox actually downloaded. Returns an error message or null. */
async function checkImportedImage(
	db: Database,
	image: BaseImageRow,
	sizeBytes: number,
	virtualSizeBytes: number,
	format: string
) {
	if (format !== 'qcow2') {
		return 'The downloaded file is not a valid qcow2 image';
	}
	if (sizeBytes > limits.maxImageBytes) {
		return `Images can be at most ${formatGiB(limits.maxImageBytes)}`;
	}
	if (virtualSizeBytes > limits.maxVirtualSizeBytes) {
		return `qcow2 virtual size can be at most ${formatGiB(limits.maxVirtualSizeBytes)}`;
	}
	if (image.ownerProjectId) {
		const [usage] = await projectUsageQuery(db, image.ownerProjectId, image.id);
		if (Number(usage?.bytes ?? 0) + sizeBytes > limits.maxProjectBytes) {
			return `This image exceeds the ${formatGiB(limits.maxProjectBytes)} custom image storage limit`;
		}
	}
	return null;
}

async function settleFinishedImport(db: Database, image: BaseImageRow, now: number) {
	const backend = getBackend('proxmox');
	const [volume, info] = await Promise.all([
		backend.getCustomImageVolume(image.filePath).catch(() => null),
		backend.getCustomImageVolumeInfo(image.filePath).catch(() => null)
	]);
	if (!(volume && info)) {
		await markFailed(db, image, 'Import finished but the image is missing from storage');
		return { ...image, status: 'failed' as const };
	}

	// The server may have sent Proxmox something different from what the Worker
	// saw, so limits are re-checked against the real file.
	const problem = await checkImportedImage(db, image, volume.size, info.virtualSize, info.format);
	if (problem) {
		await markFailed(db, image, problem);
		await backend.deleteCustomImageVolume(image.filePath).catch((err) => {
			console.warn(`Failed to delete rejected image ${image.id}`, err);
		});
		return { ...image, status: 'failed' as const, statusError: problem };
	}

	const [updated] = await db
		.update(baseImages)
		.set({
			status: 'ready',
			statusError: null,
			sizeBytes: volume.size,
			virtualSizeBytes: info.virtualSize,
			updatedAt: now
		})
		.where(and(eq(baseImages.id, image.id), eq(baseImages.status, 'importing')))
		.returning();
	return updated ?? image;
}

/** Poll Proxmox for an importing image and settle it. Safe to call repeatedly. */
export async function refreshCustomImage(db: Database, image: BaseImageRow): Promise<BaseImageRow> {
	if (image.status !== 'importing') {
		return image;
	}
	const now = Date.now();
	if (!(image.importNode && image.importUpid)) {
		// Row exists but the import never started (e.g. the worker died mid-request).
		if (now - image.updatedAt > 10 * 60 * 1000) {
			await markFailed(db, image, 'Import did not start');
			return { ...image, status: 'failed', statusError: 'Import did not start' };
		}
		return image;
	}

	let task: { status: 'running' | 'stopped'; exitstatus?: string };
	try {
		task = await getBackend('proxmox').getTaskStatus(image.importNode, image.importUpid);
	} catch (err) {
		console.warn(`Failed to read import task for image ${image.id}`, err);
		return image;
	}

	if (task.status === 'running') {
		if (now - image.createdAt > limits.importTimeoutMs) {
			await markFailed(db, image, 'Import timed out');
			return { ...image, status: 'failed', statusError: 'Import timed out' };
		}
		return image;
	}

	const ok = task.exitstatus === 'OK' || task.exitstatus?.startsWith('WARNINGS');
	if (!ok) {
		console.warn(`Import for image ${image.id} failed: ${task.exitstatus}`);
		const message = describeImportFailure(task.exitstatus);
		await markFailed(db, image, message);
		return { ...image, status: 'failed', statusError: message };
	}

	return await settleFinishedImport(db, image, now);
}

export async function refreshProjectCustomImages(db: Database, rows: BaseImageRow[]) {
	return await Promise.all(rows.map((row) => refreshCustomImage(db, row)));
}

/**
 * Remove an image row and its storage. Storage cleanup is best-effort and
 * returned unawaited; anything left behind is swept by `reconcileCustomImages`.
 */
export async function deleteCustomImage(
	db: Database,
	image: BaseImageRow,
	options: { force?: boolean } = {}
) {
	if (!isCustomImage(image)) {
		error(400, 'Platform images are managed by admins');
	}
	if (!options.force) {
		const [provisioning] = await db
			.select({ id: vms.id })
			.from(vms)
			.where(and(eq(vms.sourceImageId, image.id), eq(vms.status, 'provisioning')))
			.limit(1);
		if (provisioning) {
			error(409, 'A server is still being provisioned from this image. Try again shortly.');
		}
	}

	await db.delete(baseImages).where(eq(baseImages.id, image.id));
	const cleanup =
		image.status === 'ready' && image.filePath
			? getBackend('proxmox')
					.deleteCustomImageVolume(image.filePath)
					.catch((err) => {
						console.warn(`Failed to delete Proxmox volume for image ${image.id}`, err);
					})
			: Promise.resolve();
	return { cleanup };
}

export async function deleteProjectCustomImages(db: Database, projectId: string) {
	const rows = await db.query.baseImages.findMany({
		where: eq(baseImages.ownerProjectId, projectId)
	});
	for (const row of rows) {
		// biome-ignore lint/performance/noAwaitInLoops: Proxmox storage deletes are serialized per node
		const { cleanup } = await deleteCustomImage(db, row, { force: true });
		await cleanup;
	}
	return rows.length;
}

// Reconciliation (cron)

interface ReconcileResult {
	errors: string[];
	orphanVolumes: number;
	purgedFailed: number;
	refreshed: number;
}

async function refreshImporting(db: Database, result: ReconcileResult) {
	const importing = await db.query.baseImages.findMany({
		where: eq(baseImages.status, 'importing'),
		limit: 100
	});
	for (const row of importing) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: bounded batch of Proxmox task polls
			await refreshCustomImage(db, row);
			result.refreshed += 1;
		} catch (err) {
			result.errors.push(`refresh ${row.id}: ${errorMessage(err)}`);
		}
	}
}

async function purgeOldFailures(db: Database, now: number, result: ReconcileResult) {
	// Failed rows still count against the image limit; drop them after a while.
	const purged = await db
		.delete(baseImages)
		.where(
			and(
				eq(baseImages.status, 'failed'),
				lt(baseImages.updatedAt, now - FAILED_RETENTION_MS),
				isNotNull(baseImages.ownerProjectId)
			)
		)
		.returning({ id: baseImages.id });
	result.purgedFailed = purged.length;
}

async function sweepOrphanVolumes(db: Database, now: number, result: ReconcileResult) {
	const backend = getBackend('proxmox');
	const volumes = await backend.listCustomImageVolumes();
	const candidates = volumes.flatMap((volume) => {
		const filename = volume.volid.split('/').at(-1) ?? '';
		const match = VOLUME_FILENAME_PATTERN.exec(filename);
		return match ? [{ volume, imageId: match[1].toUpperCase() }] : [];
	});
	if (candidates.length === 0) {
		return;
	}
	const rows = await db
		.select({ id: baseImages.id, status: baseImages.status, filePath: baseImages.filePath })
		.from(baseImages)
		.where(
			inArray(
				baseImages.id,
				candidates.map((item) => item.imageId)
			)
		);
	const live = new Map(rows.map((row) => [row.id, row]));
	const orphans = candidates.filter(({ volume, imageId }) => {
		const row = live.get(imageId);
		const keep =
			row?.filePath === volume.volid && (row.status === 'ready' || row.status === 'importing');
		const oldEnough = !volume.createdAt || now - volume.createdAt > ORPHAN_GRACE_MS;
		return !keep && oldEnough;
	});
	for (const { volume } of orphans) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: Proxmox storage deletes are serialized per node
			await backend.deleteCustomImageVolume(volume.volid);
			result.orphanVolumes += 1;
		} catch (err) {
			result.errors.push(`delete volume ${volume.volid}: ${errorMessage(err)}`);
		}
	}
}

export async function reconcileCustomImages(db: Database, now = Date.now()) {
	const result: ReconcileResult = { refreshed: 0, purgedFailed: 0, orphanVolumes: 0, errors: [] };
	const steps: [string, () => Promise<void>][] = [
		['refresh imports', () => refreshImporting(db, result)],
		['purge failures', () => purgeOldFailures(db, now, result)],
		['sweep volumes', () => sweepOrphanVolumes(db, now, result)]
	];
	for (const [label, step] of steps) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: steps are ordered; the sweep relies on refreshed state
			await step();
		} catch (err) {
			result.errors.push(`${label}: ${errorMessage(err)}`);
		}
	}
	return result;
}
