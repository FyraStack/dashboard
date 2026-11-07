import { eq } from 'drizzle-orm';
import { requireProjectAccess } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { vms, volumes } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';

export interface ListVolumesInput {
	projectId: string;
}

export async function listVolumes(params: ListVolumesInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	return db.query.volumes.findMany({
		where: eq(volumes.ownerProjectId, params.projectId),
		columns: { id: true, name: true, size: true, associatedVmId: true }
	});
}

export interface CreateVolumeInput {
	backend?: string;
	name: string;
	projectId: string;
	size: number;
}

export async function createVolume(params: CreateVolumeInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');

	const [inserted] = await db
		.insert(volumes)
		.values({
			name: params.name,
			size: params.size,
			ownerProjectId: params.projectId,
			createdAt: Date.now()
		})
		.returning();
	captureServerEvent(
		'volume_created',
		{ volume_id: inserted.id, size: params.size, backend: params.backend },
		{ projectId: params.projectId }
	);

	return { id: inserted.id };
}

export interface DeleteVolumeInput {
	volumeId: string;
}

export async function deleteVolume(params: DeleteVolumeInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});

	if (!vol) {
		error(404, 'Volume not found');
	}
	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'admin');

	if (vol.associatedVmId) {
		error(409, 'Detach the volume from its VM before deleting');
	}

	await db.delete(volumes).where(eq(volumes.id, params.volumeId));
	captureServerEvent(
		'volume_deleted',
		{ volume_id: vol.id, size: vol.size },
		{ projectId: vol.ownerProjectId }
	);
}

export interface AttachVolumeInput {
	vmId: string;
	volumeId: string;
}

export async function attachVolume(params: AttachVolumeInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});
	if (!vol) {
		error(404, 'Volume not found');
	}

	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'read_write');

	if (vol.associatedVmId) {
		error(409, 'Volume is already attached to a VM');
	}

	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) {
		error(404, 'VM not found');
	}
	if (vm.ownerProjectId !== vol.ownerProjectId) {
		error(400, 'Volume and VM must belong to the same project');
	}

	await db
		.update(volumes)
		.set({ associatedVmId: params.vmId })
		.where(eq(volumes.id, params.volumeId));
	captureServerEvent(
		'volume_attached',
		{ volume_id: vol.id, vm_id: params.vmId },
		{ projectId: vol.ownerProjectId }
	);
}

export interface DetachVolumeInput {
	volumeId: string;
}

export async function detachVolume(params: DetachVolumeInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const vol = await db.query.volumes.findFirst({
		where: eq(volumes.id, params.volumeId)
	});
	if (!vol) {
		error(404, 'Volume not found');
	}

	await requireProjectAccess(db, event.locals.user.id, vol.ownerProjectId, 'read_write');

	await db.update(volumes).set({ associatedVmId: null }).where(eq(volumes.id, params.volumeId));
	captureServerEvent(
		'volume_detached',
		{ volume_id: vol.id, vm_id: vol.associatedVmId },
		{ projectId: vol.ownerProjectId }
	);
}
