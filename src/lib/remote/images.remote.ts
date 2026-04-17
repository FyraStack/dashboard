import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { baseImages } from '$lib/server/db/schema';
import { getBackend } from '$lib/server/backends';

type ImageRow = {
	id: string;
	name: string;
	version: string;
	description: string;
	shortName: string;
	icon: string | null;
	color: string;
	filePath: string;
	isa: string;
};

export const listImages = query(type({}), async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	return db.query.baseImages.findMany();
});

const createParams = type({
	name: 'string',
	source: 'string',
	architecture: "'x86' | 'arm' | 'risc-v'",
	url: 'string?'
});
export const createImage = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	const [inserted] = await db
		.insert(baseImages)
		.values({
			name: params.name,
			version: params.source,
			description: '',
			shortName: params.name,
			icon: null,
			color: '#3b82f6',
			filePath: params.url ?? '',
			isa: params.architecture
		})
		.returning();

	return { id: inserted.id };
});

const updateParams = type({
	imageId: 'string',
	name: 'string?',
	isPublic: 'boolean?',
	url: 'string?'
});
export const updateImage = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) error(404, 'Image not found');

	const updates: Record<string, unknown> = {};
	if (params.name !== undefined) updates.name = params.name;
	if (params.url !== undefined) updates.filePath = params.url;

	const keys = Object.keys(updates);
	if (keys.length === 0) return;

	await db.update(baseImages).set(updates).where(eq(baseImages.id, params.imageId));
});

const deleteParams = type({ imageId: 'string' });
export const deleteImage = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const existing = await db.query.baseImages.findFirst({
		where: eq(baseImages.id, params.imageId)
	});
	if (!existing) error(404, 'Image not found');

	await db.delete(baseImages).where(eq(baseImages.id, params.imageId));
});

type ProxmoxIso = {
	volid: string;
	filename: string;
	size: number;
	node: string;
};

export const listProxmoxIsos = query(type({}), async () => {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const backend = getBackend('proxmox');
	const client = (backend as any).client;
	if (!client) error(500, 'Proxmox client not available');

	const nodes = await client.listNodes();
	const results: ProxmoxIso[] = [];
	const seen = new Set<string>();

	for (const node of nodes) {
		try {
			const storages = await client.listStorage(node.node);
			const isoStorages = storages.filter(
				(s: any) => s.content?.includes('iso') && s.active !== 0
			);

			for (const storage of isoStorages) {
				try {
					const contents = await client.listStorageContent(node.node, storage.storage, 'iso');
					for (const item of contents) {
						if (!seen.has(item.volid)) {
							seen.add(item.volid);
							const parts = item.volid.split('/');
							results.push({
								volid: item.volid,
								filename: parts[parts.length - 1] ?? item.volid,
								size: item.size,
								node: node.node
							});
						}
					}
				} catch {}
			}
		} catch {}
	}

	return results;
});
