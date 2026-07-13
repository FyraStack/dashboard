import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { asc, desc, eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { baseImages } from '$lib/server/db/schema';
import { getBackend } from '$lib/server/backends';
import { requireAdmin } from '$lib/server/auth-context';

type ImageRow = {
	id: string;
	name: string;
	version: string;
	description: string;
	icon: string | null;
	color: string;
	isOfficial: boolean;
	logoSvg: string | null;
	accentColor: string;
	imageType: string;
	secureBoot: boolean;
	filePath: string;
	isa: string;
};

const checksumAlgorithms = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'] as const;

function validateAccentColor(value: string) {
	if (!/^#[0-9a-fA-F]{6}$/.test(value)) error(400, 'Accent color must be a hex color like #51A2DA');
}

function validateLogoSvg(value: string | undefined, isOfficial: boolean) {
	const svg = value?.trim();
	if (!isOfficial || !svg) return svg;
	const lower = svg.toLowerCase();
	if (!lower.startsWith('<svg') || !lower.endsWith('</svg>')) error(400, 'Logo must be an SVG');
	if (lower.includes('<script') || lower.includes('<foreignobject')) {
		error(400, 'SVG logo contains unsupported markup');
	}
	if (/\son[a-z]+\s*=/.test(lower) || /\s(?:href|xlink:href)\s*=\s*["']https?:/i.test(svg)) {
		error(400, 'SVG logo contains unsafe attributes');
	}
	return svg;
}

async function getUploadedImage(volid: string) {
	const backend = getBackend('proxmox');
	const images = await backend.listImages();
	return images.find((image) => image.volid === volid) ?? null;
}

export const listImages = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
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
});

const createParams = type({
	name: 'string',
	version: 'string',
	description: 'string',
	icon: 'string?',
	color: 'string?',
	isOfficial: 'boolean?',
	logoSvg: 'string?',
	accentColor: 'string?',
	secureBoot: 'boolean?',
	filePath: 'string',
	isa: "'x86'"
});
export const createImage = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);
	const isOfficial = params.isOfficial ?? false;
	const selectedImage = await getUploadedImage(params.filePath);
	if (!selectedImage) error(400, 'Select an uploaded Proxmox import image');
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
});

const updateParams = type({
	imageId: 'string',
	name: 'string?',
	version: 'string?',
	description: 'string?',
	icon: 'string?',
	color: 'string?',
	isOfficial: 'boolean?',
	logoSvg: 'string?',
	accentColor: 'string?',
	secureBoot: 'boolean?',
	filePath: 'string?',
	isa: "'x86'?"
});
export const updateImage = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) error(404, 'Image not found');

	const { imageId, ...fields } = params;
	const updates: Record<string, unknown> = Object.fromEntries(
		Object.entries(fields).filter(([, v]) => v !== undefined)
	);
	if (updates.filePath) {
		const selectedImage = await getUploadedImage(String(updates.filePath));
		if (!selectedImage) error(400, 'Select an uploaded Proxmox import image');
		updates.imageType = selectedImage.format || 'qcow2';
	}
	if (updates.accentColor) validateAccentColor(String(updates.accentColor));
	if (updates.logoSvg !== undefined || updates.isOfficial !== undefined) {
		const logoSvg = validateLogoSvg(
			updates.logoSvg === undefined ? (existing.logoSvg ?? undefined) : String(updates.logoSvg),
			Boolean(updates.isOfficial ?? existing.isOfficial)
		);
		updates.logoSvg = logoSvg ?? null;
	}
	if (Object.keys(updates).length === 0) return;

	await db.update(baseImages).set(updates).where(eq(baseImages.id, params.imageId));
});

const reorderParams = type({ imageIds: 'string[]' });
export const reorderImages = command(reorderParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

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
});

const deleteParams = type({ imageId: 'string' });
export const deleteImage = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) error(404, 'Image not found');

	await db.delete(baseImages).where(eq(baseImages.id, params.imageId));
});

export const listProxmoxImages = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	await requireAdmin(initDrizzle(), event.locals.user.id);

	const backend = getBackend('proxmox');
	return backend.listImages();
});

export const listProxmoxImageImportTargets = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	await requireAdmin(initDrizzle(), event.locals.user.id);

	const backend = getBackend('proxmox');
	return backend.listImageImportTargets();
});

const importUrlParams = type({
	url: 'string',
	filename: 'string',
	storage: 'string?',
	checksum: 'string?',
	checksumAlgorithm: "'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512'?",
	verifyCertificates: 'boolean?'
});
export const importProxmoxImageFromUrl = command(importUrlParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');
	await requireAdmin(initDrizzle(), event.locals.user.id);

	if (!/^https?:\/\//i.test(params.url))
		error(400, 'Image URL must start with http:// or https://');
	if (!params.filename.trim()) error(400, 'Filename is required');
	if (params.checksumAlgorithm && !checksumAlgorithms.includes(params.checksumAlgorithm)) {
		error(400, 'Unsupported checksum algorithm');
	}

	const backend = getBackend('proxmox');
	const storage = params.storage?.trim() || 'local';
	const targets = (await backend.listImageImportTargets()).filter(
		(target) => target.storage === storage
	);
	if (targets.length === 0)
		error(400, `No online Proxmox nodes expose import storage "${storage}"`);

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
});

const taskStatusParams = type({ node: 'string', upid: 'string' });
export const getProxmoxTaskStatus = query(taskStatusParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');
	await requireAdmin(initDrizzle(), event.locals.user.id);

	const backend = getBackend('proxmox');
	return backend.getTaskStatus(params.node, params.upid);
});
