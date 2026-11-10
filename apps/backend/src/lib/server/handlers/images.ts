import { asc, desc, eq } from 'drizzle-orm';
import { type ChecksumAlgorithm, checksumAlgorithms, type defaultIsa } from 'stack-shared/compute';
import { requireAdminUser, requireUser } from '#lib/server/auth-context.js';
import { proxmox } from '#lib/server/backends/index.js';
import { baseImages } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SVG_EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=/;
const SVG_REMOTE_HREF_PATTERN = /\s(?:href|xlink:href)\s*=\s*["']https?:/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;

const DEFAULT_IMPORT_STORAGE = 'local';

function validateAccentColor(value: string) {
	if (!HEX_COLOR_PATTERN.test(value)) {
		error(400, 'Accent color must be a hex color like #51A2DA');
	}
}

function validateLogoSvg(value: string | undefined, isOfficial: boolean) {
	const svg = value?.trim();
	if (!(isOfficial && svg)) {
		return svg;
	}
	const lower = svg.toLowerCase();
	if (!(lower.startsWith('<svg') && lower.endsWith('</svg>'))) {
		error(400, 'Logo must be an SVG');
	}
	if (lower.includes('<script') || lower.includes('<foreignobject')) {
		error(400, 'SVG logo contains unsupported markup');
	}
	if (SVG_EVENT_HANDLER_PATTERN.test(lower) || SVG_REMOTE_HREF_PATTERN.test(svg)) {
		error(400, 'SVG logo contains unsafe attributes');
	}
	return svg;
}

async function getUploadedImage(volid: string) {
	const images = await proxmox().listImages();
	return images.find((image) => image.volid === volid) ?? null;
}

export async function listImages() {
	const { db } = requireUser();
	const rows = await db.query.baseImages.findMany({
		orderBy: [asc(baseImages.sortOrder), asc(baseImages.id)]
	});
	return rows.map((row) => ({
		id: row.id,
		filePath: row.filePath,
		name: row.name,
		version: row.version,
		description: row.description,
		icon: row.icon,
		color: row.color,
		isOfficial: row.isOfficial,
		logoSvg: row.logoSvg,
		accentColor: row.accentColor,
		imageType: row.imageType,
		secureBoot: row.secureBoot,
		isa: row.isa
	}));
}

export interface CreateImageInput {
	accentColor?: string;
	color?: string;
	description: string;
	filePath: string;
	icon?: string;
	isa: typeof defaultIsa;
	isOfficial?: boolean;
	logoSvg?: string;
	name: string;
	secureBoot?: boolean;
	version: string;
}

export async function createImage(params: CreateImageInput) {
	const { db } = await requireAdminUser();
	const isOfficial = params.isOfficial ?? false;
	const selectedImage = await getUploadedImage(params.filePath);
	if (!selectedImage) {
		error(400, 'Select an uploaded Proxmox import image');
	}
	const accentColor = params.accentColor ?? '#6b7280';
	validateAccentColor(accentColor);
	const logoSvg = validateLogoSvg(params.logoSvg, isOfficial);

	const lastImage = await db.query.baseImages.findFirst({
		orderBy: [desc(baseImages.sortOrder)]
	});

	const [inserted] = await db
		.insert(baseImages)
		.values({
			sortOrder: (lastImage?.sortOrder ?? -1) + 1,
			name: params.name,
			version: params.version,
			description: params.description,
			icon: params.icon,
			color: params.color ?? 'bg-gray-600',
			isOfficial,
			logoSvg,
			accentColor,
			imageType: selectedImage.format || 'qcow2',
			secureBoot: params.secureBoot ?? true,
			filePath: params.filePath,
			isa: params.isa
		})
		.returning();

	return { id: inserted.id };
}

export interface UpdateImageInput {
	accentColor?: string;
	color?: string;
	description?: string;
	filePath?: string;
	icon?: string;
	imageId: string;
	isa?: typeof defaultIsa;
	isOfficial?: boolean;
	logoSvg?: string;
	name?: string;
	secureBoot?: boolean;
	version?: string;
}

export async function updateImage(params: UpdateImageInput) {
	const { db } = await requireAdminUser();

	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) {
		error(404, 'Image not found');
	}

	const { imageId, ...fields } = params;
	const updates: Record<string, unknown> = Object.fromEntries(
		Object.entries(fields).filter(([, v]) => v !== undefined)
	);
	if (updates.filePath) {
		const selectedImage = await getUploadedImage(String(updates.filePath));
		if (!selectedImage) {
			error(400, 'Select an uploaded Proxmox import image');
		}
		updates.imageType = selectedImage.format || 'qcow2';
	}
	if (updates.accentColor) {
		validateAccentColor(String(updates.accentColor));
	}
	if (updates.logoSvg !== undefined || updates.isOfficial !== undefined) {
		const logoSvg = validateLogoSvg(
			updates.logoSvg === undefined ? (existing.logoSvg ?? undefined) : String(updates.logoSvg),
			Boolean(updates.isOfficial ?? existing.isOfficial)
		);
		updates.logoSvg = logoSvg ?? null;
	}
	if (Object.keys(updates).length === 0) {
		return;
	}

	await db.update(baseImages).set(updates).where(eq(baseImages.id, params.imageId));
}

export interface ReorderImagesInput {
	imageIds: string[];
}

export async function reorderImages(params: ReorderImagesInput) {
	const { db } = await requireAdminUser();

	const rows = await db.query.baseImages.findMany({ columns: { id: true } });
	const existingIds = new Set(rows.map((row) => row.id));
	const requestedIds = new Set(params.imageIds);
	if (
		params.imageIds.length !== existingIds.size ||
		requestedIds.size !== existingIds.size ||
		params.imageIds.some((id) => !existingIds.has(id))
	) {
		error(400, 'Image order is out of date, refresh and try again');
	}

	await Promise.all(
		params.imageIds.map((id, index) =>
			db.update(baseImages).set({ sortOrder: index }).where(eq(baseImages.id, id))
		)
	);
}

export interface DeleteImageInput {
	imageId: string;
}

export async function deleteImage(params: DeleteImageInput) {
	const { db } = await requireAdminUser();

	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) {
		error(404, 'Image not found');
	}

	await db.delete(baseImages).where(eq(baseImages.id, params.imageId));
}

export async function listProxmoxImages() {
	await requireAdminUser();

	return proxmox().listImages();
}

export async function listProxmoxImageImportTargets() {
	await requireAdminUser();

	return proxmox().listImageImportTargets();
}

export interface ImportProxmoxImageFromUrlInput {
	checksum?: string;
	checksumAlgorithm?: ChecksumAlgorithm;
	filename: string;
	storage?: string;
	url: string;
	verifyCertificates?: boolean;
}

export async function importProxmoxImageFromUrl(params: ImportProxmoxImageFromUrlInput) {
	await requireAdminUser();

	if (!HTTP_URL_PATTERN.test(params.url)) {
		error(400, 'Image URL must start with http:// or https://');
	}
	if (!params.filename.trim()) {
		error(400, 'Filename is required');
	}
	if (params.checksumAlgorithm && !checksumAlgorithms.includes(params.checksumAlgorithm)) {
		error(400, 'Unsupported checksum algorithm');
	}

	const backend = proxmox();
	const storage = params.storage?.trim() || DEFAULT_IMPORT_STORAGE;
	const targets = (await backend.listImageImportTargets()).filter(
		(target) => target.storage === storage
	);
	if (targets.length === 0) {
		error(400, `No online Proxmox nodes expose import storage "${storage}"`);
	}

	const tasks = await Promise.all(
		targets.map(async (target) => ({
			node: target.node,
			storage: target.storage,
			upid: await backend.importImageFromUrl({
				node: target.node,
				storage: target.storage,
				url: params.url,
				filename: params.filename,
				checksum: params.checksum?.trim() || undefined,
				checksumAlgorithm: params.checksumAlgorithm,
				verifyCertificates: params.verifyCertificates ?? true
			})
		}))
	);

	return { storage, tasks };
}

export interface GetProxmoxTaskStatusInput {
	node: string;
	upid: string;
}

export async function getProxmoxTaskStatus(params: GetProxmoxTaskStatusInput) {
	await requireAdminUser();

	return proxmox().getTaskStatus(params.node, params.upid);
}
