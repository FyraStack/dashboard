import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureImages
} from '#lib/server/accessibility-fixtures.js';
import { requireProjectAccess } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import {
	type BaseImageRow,
	createCustomImageImport,
	customImageLimits,
	deleteCustomImage as deleteCustomImageResources,
	getProjectImageUsage,
	refreshProjectCustomImages,
	validateImageMetadata
} from '#lib/server/custom-images.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { baseImages } from '#lib/server/db/schema.js';
import { getFeatureFlags, requireFeatureFlag } from '#lib/server/feature-flags.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { command, getRequestEvent, query } from '$app/server';

function requireUser() {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}
	return event.locals.user;
}

function toCustomImage(row: BaseImageRow) {
	return {
		id: row.id,
		name: row.name,
		version: row.version,
		description: row.description,
		imageType: row.imageType,
		isa: row.isa,
		secureBoot: row.secureBoot,
		status: row.status,
		statusError: row.statusError,
		sizeBytes: row.sizeBytes,
		virtualSizeBytes: row.virtualSizeBytes,
		sourceUrl: row.sourceUrl,
		createdAt: row.createdAt,
		createdByUserId: row.createdByUserId
	};
}

export type CustomImage = ReturnType<typeof toCustomImage>;

/**
 * Load an image for a mutation. Images from other projects 404 the same way
 * missing ones do, so ids can't be probed across projects.
 */
async function loadProjectImage(
	db: ReturnType<typeof initDrizzle>,
	userId: string,
	imageId: string,
	minLevel: 'read_write' | 'admin' = 'read_write'
) {
	const image = await db.query.baseImages.findFirst({ where: eq(baseImages.id, imageId) });
	if (!image?.ownerProjectId) {
		error(404, 'Image not found');
	}
	await requireProjectAccess(db, userId, image.ownerProjectId, minLevel);
	return { ...image, ownerProjectId: image.ownerProjectId };
}

export const listProjectImages = query(type({ projectId: 'string' }), async (params) => {
	const user = requireUser();
	if (accessibilityFixtureEnabled) {
		return {
			platformImages: accessibilityFixtureImages,
			customImages: [] as CustomImage[],
			importsEnabled: false,
			usage: { count: 0, bytes: 0 },
			limits: customImageLimits()
		};
	}
	const db = initDrizzle();
	await requireProjectAccess(db, user.id, params.projectId);

	const flags = await getFeatureFlags();
	const [platformRows, customRows] = await Promise.all([
		db.query.baseImages.findMany({
			where: isNull(baseImages.ownerProjectId),
			orderBy: [asc(baseImages.sortOrder), asc(baseImages.id)]
		}),
		flags.images
			? db.query.baseImages.findMany({
					where: eq(baseImages.ownerProjectId, params.projectId),
					orderBy: [desc(baseImages.createdAt)]
				})
			: Promise.resolve([])
	]);

	const refreshed = await refreshProjectCustomImages(db, customRows);
	const usage = flags.images
		? await getProjectImageUsage(db, params.projectId)
		: { count: 0, bytes: 0 };

	return {
		platformImages: platformRows.map((row) => ({
			id: row.id,
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
		})),
		customImages: refreshed.map(toCustomImage),
		importsEnabled: flags.images,
		usage,
		limits: customImageLimits()
	};
});

const importParams = type({
	projectId: 'string',
	url: '0 < string <= 2048',
	name: 'string',
	version: 'string?',
	description: 'string?',
	checksum: 'string?',
	secureBoot: 'boolean?'
});
export const importCustomImage = command(importParams, async (params) => {
	const user = requireUser();
	await requireFeatureFlag('images');
	const db = initDrizzle();
	await requireProjectAccess(db, user.id, params.projectId, 'read_write');

	const result = await createCustomImageImport(db, {
		projectId: params.projectId,
		userId: user.id,
		url: params.url,
		name: params.name,
		version: params.version ?? '',
		description: params.description ?? '',
		checksum: params.checksum,
		secureBoot: params.secureBoot ?? false
	});
	captureServerEvent(
		'custom_image_import_started',
		{ image_id: result.imageId, has_checksum: Boolean(params.checksum?.trim()) },
		{ projectId: params.projectId }
	);
	return result;
});

const updateParams = type({
	imageId: 'string',
	name: 'string?',
	version: 'string?',
	description: 'string?',
	secureBoot: 'boolean?'
});
export const updateCustomImage = command(updateParams, async (params) => {
	const user = requireUser();
	const db = initDrizzle();
	const image = await loadProjectImage(db, user.id, params.imageId);
	const { name, version, description } = validateImageMetadata(params);

	const updates = Object.fromEntries(
		Object.entries({ name, version, description, secureBoot: params.secureBoot }).filter(
			([, value]) => value !== undefined
		)
	);
	if (Object.keys(updates).length === 0) {
		return;
	}
	await db
		.update(baseImages)
		.set({ ...updates, updatedAt: Date.now() })
		.where(and(eq(baseImages.id, image.id), eq(baseImages.ownerProjectId, image.ownerProjectId)));
});

export const deleteCustomImage = command(type({ imageId: 'string' }), async (params) => {
	const user = requireUser();
	const db = initDrizzle();
	// Members can delete images they imported; anything else needs project admin.
	let image = await loadProjectImage(db, user.id, params.imageId);
	if (image.createdByUserId !== user.id) {
		image = await loadProjectImage(db, user.id, params.imageId, 'admin');
	}

	const { cleanup } = await deleteCustomImageResources(db, image);
	runInBackground(cleanup, `delete custom image ${image.id}`);
	captureServerEvent(
		'custom_image_deleted',
		{ image_id: image.id, status: image.status, size_bytes: image.sizeBytes },
		{ projectId: image.ownerProjectId }
	);
});
