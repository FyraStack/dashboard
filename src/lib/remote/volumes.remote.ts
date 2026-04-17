import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { volumes, vms } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/rpc/context';

type ListParams = { projectId: string };
type ListResult = {
	id: string;
	name: string;
	size: number;
	associatedVmId: string | null;
}[];

export const listVolumes = query(type({ projectId: 'string' }), async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	return db.query.volumes.findMany({
		where: eq(volumes.ownerProjectId, params.projectId),
		columns: { id: true, name: true, size: true, associatedVmId: true }
	});
});

const getParams = type({ volumeId: 'string' });
type GetResult = {
	id: string;
	name: string;
	size: number;
	ownerProjectId: string;
	associatedVmId: string | null;
};

export const getVolume = query(getParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});

	if (!vol) error(404, 'Volume not found');
	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId);
	return vol;
});

const createParams = type({
	projectId: 'string',
	name: 'string',
	size: 'number',
	backend: 'string?'
});
export const createVolume = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');

	const [inserted] = await db
		.insert(volumes)
		.values({
			name: params.name,
			size: params.size,
			ownerProjectId: params.projectId
		})
		.returning();

	return { id: inserted.id };
});

const deleteParams = type({ volumeId: 'string' });
export const deleteVolume = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});

	if (!vol) error(404, 'Volume not found');
	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'admin');

	if (vol.associatedVmId) {
		error(409, 'Detach the volume from its VM before deleting');
	}

	await db.delete(volumes).where(eq(volumes.id, params.volumeId));
});

const attachParams = type({ volumeId: 'string', vmId: 'string' });
export const attachVolume = command(attachParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});
	if (!vol) error(404, 'Volume not found');

	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'read_write');

	if (vol.associatedVmId) {
		error(409, 'Volume is already attached to a VM');
	}

	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) error(404, 'VM not found');
	if (vm.ownerProjectId !== vol.ownerProjectId) {
		error(400, 'Volume and VM must belong to the same project');
	}

	await db
		.update(volumes)
		.set({ associatedVmId: params.vmId })
		.where(eq(volumes.id, params.volumeId));
});

const detachParams = type({ volumeId: 'string' });
export const detachVolume = command(detachParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});
	if (!vol) error(404, 'Volume not found');

	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'read_write');

	await db
		.update(volumes)
		.set({ associatedVmId: null })
		.where(eq(volumes.id, params.volumeId));
});
