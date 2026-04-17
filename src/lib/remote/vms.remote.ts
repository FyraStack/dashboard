import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { vms, vmTypes, sshKeys } from '$lib/server/db/schema';
import { getBackend, type VmInfo } from '$lib/server/backends';
import { requireProjectAccess } from '$lib/server/rpc/context';

const listParams = type({ projectId: 'string' });
export const listVms = query(listParams, async (params) => {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const rows = await db.query.vms.findMany({
		where: eq(vms.ownerProjectId, params.projectId),
		with: { vmType: true }
	});

	let liveVms: VmInfo[] = [];
	try {
		const backend = getBackend('proxmox');
		liveVms = await backend.listVms();
	} catch {}

	const liveMap = new Map(liveVms.map((v) => [v.id, v]));

	return rows.map((row) => ({
		id: row.id,
		active: row.active,
		vmTypeId: row.vmTypeId,
		creationDate: row.creationDate,
		backend: row.backend,
		status: row.status,
		vmType: row.vmType
			? {
					name: row.vmType.name,
					cores: row.vmType.cores,
					ramCapacity: row.vmType.ramCapacity,
					storageAmount: row.vmType.storageAmount
				}
			: null,
		live: liveMap.get(row.id) ?? null
	}));
});

const getParams = type({ vmId: 'string' });
export const getVm = query(getParams, async (params) => {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({
		where: eq(vms.id, params.vmId),
		with: { vmType: true, project: true }
	});

	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId);
	}

	let live: VmInfo | null = null;
	try {
		const backend = getBackend(row.backend);
		live = await backend.getVm(row.id);
	} catch {}

	return {
		id: row.id,
		active: row.active,
		vmTypeId: row.vmTypeId,
		creationDate: row.creationDate,
		backend: row.backend,
		vmType: row.vmType
			? {
					name: row.vmType.name,
					cores: row.vmType.cores,
					ramCapacity: row.vmType.ramCapacity,
					storageAmount: row.vmType.storageAmount
				}
			: null,
		live
	};
});

const createParams = type({
	projectId: 'string',
	vmTypeId: 'string',
	name: 'string',
	imageId: 'string?',
	sshKeyIds: 'string[]?'
});
export const createVm = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');

	const vmType = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!vmType) error(400, `VM type "${params.vmTypeId}" not found`);

	let publicKeys: string[] = [];
	if (params.sshKeyIds?.length) {
		const keys = await db.query.sshKeys.findMany({
			where: eq(sshKeys.userId, event.locals.user.id)
		});
		publicKeys = keys
			.filter((k) => params.sshKeyIds!.includes(k.id))
			.map((k) => k.publicKey);
	}

	const [inserted] = await db
		.insert(vms)
		.values({
			active: true,
			ownerProjectId: params.projectId,
			vmTypeId: params.vmTypeId,
			creationDate: new Date().toISOString().split('T')[0],
			backend: 'proxmox',
			status: 'provisioning'
		})
		.returning();

	const vmId = inserted.id;
	let result;
	try {
		const backend = getBackend('proxmox');
		result = await backend.createVm({
			id: vmId,
			name: params.name,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			imageId: params.imageId,
			sshKeys: publicKeys,
			onProvisionSettled: ({ ok, error: err }) => {
				const db = initDrizzle();
				db.update(vms)
					.set(ok ? { status: 'ready' } : { status: 'error', statusError: err ?? 'Unknown error' })
					.where(eq(vms.id, vmId))
					.then(() => console.log(`VM ${vmId} provision ${ok ? 'succeeded' : 'failed'}`))
					.catch((err) => console.error(`VM ${vmId} status update failed:`, err));
			}
		});
	} catch (err) {
		await db.delete(vms).where(eq(vms.id, inserted.id));
		throw err;
	}

	return { id: inserted.id, taskId: result.taskId };
});

const deleteParams = type({ vmId: 'string' });
export const deleteVm = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId, 'admin');
	}

	try {
		await getBackend(row.backend).deleteVm(row.id);
	} catch {}

	await db.update(vms).set({ active: false }).where(eq(vms.id, params.vmId));
});

const powerParams = type({ vmId: 'string' });
async function powerAction(vmId: string, action: 'startVm' | 'stopVm' | 'killVm' | 'rebootVm') {
	const event = getRequestEvent();
	if (!event?. locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, vmId) });
	if (!row) error(404, `VM "${vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId, 'read_write');
	}

	const backend = getBackend(row.backend);
	await backend[action](row.id);
}

export const startVm = command(powerParams, async (p) => powerAction(p.vmId, 'startVm'));
export const stopVm = command(powerParams, async (p) => powerAction(p.vmId, 'killVm'));
export const killVm = command(powerParams, async (p) => powerAction(p.vmId, 'killVm'));
export const rebootVm = command(powerParams, async (p) => powerAction(p.vmId, 'rebootVm'));
