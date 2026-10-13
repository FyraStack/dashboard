import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, exists, isNotNull, isNull, ne } from 'drizzle-orm';
import { requireProjectAccess } from '#lib/server/auth-context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { vms, volumes } from '#lib/server/db/schema.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { command, getRequestEvent, query } from '$app/server';

export const listVolumes = query(type({ projectId: 'string' }), async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	return db.query.volumes.findMany({
		where: eq(volumes.ownerProjectId, params.projectId),
		columns: { id: true, name: true, size: true, associatedVmId: true }
	});
});

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const createParams = type({
	id: 'string?',
	projectId: 'string',
	name: 'string',
	size: 'number',
	backend: 'string?'
});
export const createVolume = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}
	if (params.id !== undefined && !ULID_PATTERN.test(params.id)) {
		error(400, 'Invalid volume id');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');

	const [inserted] = await db
		.insert(volumes)
		.values({
			...(params.id ? { id: params.id } : {}),
			name: params.name,
			size: params.size,
			ownerProjectId: params.projectId,
			createdAt: Date.now()
		})
		.onConflictDoNothing({ target: volumes.id })
		.returning();
	if (!inserted) {
		const existing = await db.query.volumes.findFirst({
			where: eq(volumes.id, params.id ?? ''),
			columns: { id: true, ownerProjectId: true }
		});
		if (existing?.ownerProjectId !== params.projectId) {
			error(409, 'Volume id is already in use');
		}
		return { id: existing.id };
	}

	captureServerEvent(
		'volume_created',
		{ volume_id: inserted.id, size: params.size, backend: params.backend },
		{ projectId: params.projectId }
	);

	return { id: inserted.id };
});

const deleteParams = type({ volumeId: 'string' });
export const deleteVolume = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
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

	const deleted = await db
		.delete(volumes)
		.where(and(eq(volumes.id, params.volumeId), isNull(volumes.associatedVmId)))
		.returning({ id: volumes.id });
	if (deleted.length === 0) {
		error(409, 'Detach the volume from its VM before deleting');
	}

	captureServerEvent(
		'volume_deleted',
		{ volume_id: vol.id, size: vol.size },
		{ projectId: vol.ownerProjectId }
	);
});

const attachParams = type({ volumeId: 'string', vmId: 'string' });
export const attachVolume = command(attachParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
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

	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) {
		error(404, 'VM not found');
	}
	if (vm.ownerProjectId !== vol.ownerProjectId) {
		error(400, 'Volume and VM must belong to the same project');
	}
	if (!vm.active || vm.status === 'deleting') {
		error(409, 'VM is not available');
	}

	const attached = await db
		.update(volumes)
		.set({ associatedVmId: params.vmId })
		.where(
			and(
				eq(volumes.id, params.volumeId),
				isNull(volumes.associatedVmId),
				exists(
					db
						.select({ id: vms.id })
						.from(vms)
						.where(
							and(
								eq(vms.id, params.vmId),
								eq(vms.active, true),
								ne(vms.status, 'deleting'),
								eq(vms.ownerProjectId, vol.ownerProjectId)
							)
						)
				)
			)
		)
		.returning({ id: volumes.id });
	if (attached.length === 0) {
		const current = await db.query.volumes.findFirst({
			where: eq(volumes.id, params.volumeId),
			columns: { associatedVmId: true }
		});
		if (current?.associatedVmId === params.vmId) {
			return;
		}
		error(
			409,
			current?.associatedVmId ? 'Volume is already attached to a VM' : 'VM is not available'
		);
	}

	captureServerEvent(
		'volume_attached',
		{ volume_id: vol.id, vm_id: params.vmId },
		{ projectId: vol.ownerProjectId }
	);
});

const detachParams = type({ volumeId: 'string' });
export const detachVolume = command(detachParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
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

	const detached = await db
		.update(volumes)
		.set({ associatedVmId: null })
		.where(and(eq(volumes.id, params.volumeId), isNotNull(volumes.associatedVmId)))
		.returning({ id: volumes.id });
	if (detached.length === 0) {
		return;
	}
	captureServerEvent(
		'volume_detached',
		{ volume_id: vol.id, vm_id: vol.associatedVmId },
		{ projectId: vol.ownerProjectId }
	);
});
