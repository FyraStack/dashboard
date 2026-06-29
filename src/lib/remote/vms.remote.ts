import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, sql } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { vms, vmTypes, sshKeys, baseImages } from '$lib/server/db/schema';
import { getBackend, type VmInfo, type VmMetricsTimeframe } from '$lib/server/backends';
import { requireProjectAccess } from '$lib/server/auth-context';
import {
	deleteProjectServerEntity,
	ensureProjectServerEntity,
	requireProjectBillingActive
} from '$lib/server/billing/autumn';
import { createBillingMeter, meterResourceThrough } from '$lib/server/billing/metering';
import { allocateVmNetworking, generateMacAddress, releaseVmNetworking } from '$lib/server/ipam';

type VmRow = {
	id: string;
	name: string;
	proxmoxId: number | null;
	active: boolean;
	ownerProjectId: string | null;
	vmTypeId: string;
	creationDate: string;
	createdAt: number;
	backend: 'proxmox';
	status: 'provisioning' | 'ready' | 'error';
	lastKnownIpv4: string | null;
	lastKnownIpv6: string | null;
	lastKnownStatus: VmInfo['status'] | null;
	lastKnownUptime: number;
	lastKnownAt: number | null;
	vmTypeName: string | null;
	vmTypeCores: number | null;
	vmTypeRamCapacity: number | null;
	vmTypeStorageAmount: number | null;
};

function getKnownLive(row: VmRow): VmInfo | null {
	if (!row.lastKnownStatus && !row.lastKnownIpv4 && !row.lastKnownIpv6) return null;

	return {
		id: row.name,
		proxmoxId: row.proxmoxId ?? undefined,
		name: row.name,
		status: row.lastKnownStatus ?? 'unknown',
		cores: row.vmTypeCores ?? 0,
		memory: (row.vmTypeRamCapacity ?? 0) * 1024 * 1024,
		disk: (row.vmTypeStorageAmount ?? 0) * 1024 * 1024 * 1024,
		uptime: row.lastKnownUptime ?? 0,
		networkInterfaces:
			row.lastKnownIpv4 || row.lastKnownIpv6
				? {
						cached: {
							ipAddresses: [row.lastKnownIpv4, row.lastKnownIpv6].filter(Boolean) as string[]
						}
					}
				: undefined,
		metrics: undefined
	};
}

function mapVmRow(row: VmRow, live: VmInfo | null) {
	return {
		id: row.id,
		name: row.name,
		proxmoxId: row.proxmoxId ?? undefined,
		active: row.active,
		ownerProjectId: row.ownerProjectId,
		vmTypeId: row.vmTypeId,
		creationDate: row.creationDate,
		backend: row.backend,
		status: row.status,
		vmType: row.vmTypeName
			? {
					name: row.vmTypeName,
					cores: row.vmTypeCores ?? 0,
					ramCapacity: row.vmTypeRamCapacity ?? 0,
					storageAmount: row.vmTypeStorageAmount ?? 0
				}
			: null,
		live: live ?? getKnownLive(row)
	};
}

function toDashboardStatus(
	status: VmRow['status'],
	liveStatus: VmInfo['status'] | null | undefined
): 'running' | 'stopped' | 'restarting' | 'provisioning' {
	if (liveStatus === 'running') return 'running';
	if (liveStatus === 'paused') return 'restarting';
	if (status === 'provisioning') return 'provisioning';
	return 'stopped';
}

const listParams = type({ projectId: 'string' });
export const listVms = query(listParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const result = await db.execute(sql`
		select
			${vms.id} as id,
			${vms.name} as name,
			${vms.proxmoxId} as "proxmoxId",
			${vms.active} as active,
			${vms.ownerProjectId} as "ownerProjectId",
			${vms.vmTypeId} as "vmTypeId",
			${vms.creationDate} as "creationDate",
			${vms.createdAt} as "createdAt",
			${vms.backend} as backend,
			${vms.status} as status,
			${vms.lastKnownIpv4} as "lastKnownIpv4",
			${vms.lastKnownIpv6} as "lastKnownIpv6",
			${vms.lastKnownStatus} as "lastKnownStatus",
			${vms.lastKnownUptime} as "lastKnownUptime",
			${vms.lastKnownAt} as "lastKnownAt",
			${vmTypes.name} as "vmTypeName",
			${vmTypes.cores} as "vmTypeCores",
			${vmTypes.ramCapacity} as "vmTypeRamCapacity",
			${vmTypes.storageAmount} as "vmTypeStorageAmount"
		from ${vms}
		left join ${vmTypes} on ${vmTypes.id} = ${vms.vmTypeId}
		where ${vms.ownerProjectId} = ${params.projectId}
	`);
	const rows = result.rows as VmRow[];

	return rows.map((row) => mapVmRow(row, null));
});

const getParams = type({ vmId: 'string' });
export const getVm = query(getParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const result = await db.execute(sql`
		select
			${vms.id} as id,
			${vms.name} as name,
			${vms.proxmoxId} as "proxmoxId",
			${vms.active} as active,
			${vms.ownerProjectId} as "ownerProjectId",
			${vms.vmTypeId} as "vmTypeId",
			${vms.creationDate} as "creationDate",
			${vms.createdAt} as "createdAt",
			${vms.backend} as backend,
			${vms.status} as status,
			${vms.lastKnownIpv4} as "lastKnownIpv4",
			${vms.lastKnownIpv6} as "lastKnownIpv6",
			${vms.lastKnownStatus} as "lastKnownStatus",
			${vms.lastKnownUptime} as "lastKnownUptime",
			${vms.lastKnownAt} as "lastKnownAt",
			${vmTypes.name} as "vmTypeName",
			${vmTypes.cores} as "vmTypeCores",
			${vmTypes.ramCapacity} as "vmTypeRamCapacity",
			${vmTypes.storageAmount} as "vmTypeStorageAmount"
		from ${vms}
		left join ${vmTypes} on ${vmTypes.id} = ${vms.vmTypeId}
		where ${vms.id} = ${params.vmId}
		limit 1
	`);
	const row = (result.rows as VmRow[])[0];

	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId);
	}

	let live: VmInfo | null = null;
	try {
		const backend = getBackend(row.backend);
		live = await backend.getVm(row.id, row.proxmoxId ?? undefined);
	} catch (err) {
		console.warn(`Failed to load live VM state for ${row.id}`, err);
	}

	return mapVmRow(row, live);
});

const metricsHistoryParams = type({
	vmId: 'string',
	timeframe: "'hour' | 'day' | 'week' | 'month' | 'year'?"
});
export const getVmMetricsHistory = query(metricsHistoryParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId);
	}

	try {
		return await getBackend(row.backend).getVmMetricsHistory(
			row.id,
			row.proxmoxId ?? undefined,
			(params.timeframe ?? 'hour') as VmMetricsTimeframe
		);
	} catch (err) {
		console.warn(`Failed to load VM metrics history for ${row.id}`, err);
		return [];
	}
});

const statusParams = type({ projectId: 'string' });
export const listVmStatuses = query(statusParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const result = await db.execute(sql`
		select
			${vms.id} as id,
			${vms.name} as name,
			${vms.proxmoxId} as "proxmoxId",
			${vms.active} as active,
			${vms.ownerProjectId} as "ownerProjectId",
			${vms.vmTypeId} as "vmTypeId",
			${vms.creationDate} as "creationDate",
			${vms.createdAt} as "createdAt",
			${vms.backend} as backend,
			${vms.status} as status,
			${vms.lastKnownIpv4} as "lastKnownIpv4",
			${vms.lastKnownIpv6} as "lastKnownIpv6",
			${vms.lastKnownStatus} as "lastKnownStatus",
			${vms.lastKnownUptime} as "lastKnownUptime",
			${vms.lastKnownAt} as "lastKnownAt",
			${vmTypes.name} as "vmTypeName",
			${vmTypes.cores} as "vmTypeCores",
			${vmTypes.ramCapacity} as "vmTypeRamCapacity",
			${vmTypes.storageAmount} as "vmTypeStorageAmount"
		from ${vms}
		left join ${vmTypes} on ${vmTypes.id} = ${vms.vmTypeId}
		where ${vms.ownerProjectId} = ${params.projectId}
	`);
	const rows = (result.rows as VmRow[]).filter((row) => row.active);

	let liveVms: VmInfo[] = [];
	try {
		liveVms = await getBackend('proxmox').listVms();
	} catch (err) {
		console.warn('Failed to load live Proxmox VM statuses', err);
	}

	const liveByProxmoxId = new Map(
		liveVms.filter((vm) => vm.proxmoxId != null).map((vm) => [vm.proxmoxId!, vm] as const)
	);
	const liveById = new Map(liveVms.map((vm) => [vm.id, vm]));

	return rows.map((row) => {
		const live =
			(row.proxmoxId != null ? liveByProxmoxId.get(row.proxmoxId) : null) ??
			liveById.get(row.id) ??
			null;
		const mapped = mapVmRow(row, live);
		return {
			id: mapped.id,
			status: toDashboardStatus(row.status, mapped.live?.status),
			liveStatus: mapped.live?.status ?? null,
			uptime: mapped.live?.uptime ?? 0,
			memory: mapped.live?.memory ?? null,
			disk: mapped.live?.disk ?? null,
			networkInterfaces: mapped.live?.networkInterfaces ?? null,
			metrics: mapped.live?.metrics ?? null
		};
	});
});

const createParams = type({
	projectId: 'string',
	vmTypeId: 'string',
	name: 'string',
	networkingMode: "'both' | 'ipv6'?",
	imageId: 'string?',
	sshKeyIds: 'string[]?',
	password: 'string?'
});
export const createVm = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');
	await requireProjectBillingActive(params.projectId);

	const [vmType, baseImage, keys] = await Promise.all([
		db.query.vmTypes.findFirst({
			where: eq(vmTypes.id, params.vmTypeId)
		}),
		params.imageId
			? db.query.baseImages.findFirst({
					where: eq(baseImages.id, params.imageId)
				})
			: null,
		params.sshKeyIds?.length
			? db.query.sshKeys.findMany({
					where: eq(sshKeys.userId, event.locals.user.id)
				})
			: []
	]);
	if (!vmType) error(400, `VM type "${params.vmTypeId}" not found`);
	if (!vmType.autumnFeatureId)
		error(400, `VM type "${vmType.name}" is missing an Autumn feature ID`);
	const featureId = vmType.autumnFeatureId;

	if (params.imageId && !baseImage) error(400, `Image "${params.imageId}" not found`);

	const publicKeys = params.sshKeyIds?.length
		? keys.filter((key) => params.sshKeyIds!.includes(key.id)).map((key) => key.publicKey)
		: [];

	const now = Date.now();
	const [inserted] = await db
		.insert(vms)
		.values({
			name: params.name,
			proxmoxId: null,
			active: true,
			ownerProjectId: params.projectId,
			vmTypeId: params.vmTypeId,
			creationDate: new Date().toISOString().split('T')[0],
			createdAt: now,
			backend: 'proxmox',
			status: 'provisioning'
		})
		.returning();

	const vmId = inserted.id;
	const macAddress = generateMacAddress();
	let networkingAllocations: Awaited<ReturnType<typeof allocateVmNetworking>> = [];
	let result;
	try {
		await ensureProjectServerEntity({
			projectId: params.projectId,
			serverId: vmId,
			name: params.name
		});
		networkingAllocations = await allocateVmNetworking(db, {
			vmId,
			macAddress,
			mode: params.networkingMode ?? 'both'
		});
		const ipv4NetworkAllocation = networkingAllocations.find(
			(allocation) => allocation.family === 'ipv4' && allocation.address
		);
		const ipv6TransitNetworkAllocation = networkingAllocations.find(
			(allocation) => allocation.family === 'ipv6' && allocation.address
		);
		const ipv6PrefixNetworkAllocation = networkingAllocations.find(
			(allocation) => allocation.family === 'ipv6' && allocation.prefix
		);
		const firewallIpSet = [
			...(ipv4NetworkAllocation?.address ? [`${ipv4NetworkAllocation.address}/32`] : []),
			...(ipv6TransitNetworkAllocation?.address
				? [`${ipv6TransitNetworkAllocation.address}/128`]
				: []),
			...(ipv6PrefixNetworkAllocation?.prefix ? [ipv6PrefixNetworkAllocation.prefix] : [])
		];
		const backend = getBackend('proxmox');
		result = await backend.createVm({
			id: vmId,
			name: params.name,
			proxmoxId: inserted.proxmoxId ?? undefined,
			macAddress,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			imageId: params.imageId,
			imageSource: baseImage?.filePath,
			networkConfig: {
				firewallIpSet,
				...(ipv4NetworkAllocation?.address
					? {
							ipv4: {
								address: ipv4NetworkAllocation.address,
								prefixLength: ipv4NetworkAllocation.prefixLength,
								gateway: ipv4NetworkAllocation.sourcePrefix.gatewayAddress ?? ''
							}
						}
					: {}),
				...(ipv6TransitNetworkAllocation?.address
					? {
							ipv6: {
								address: ipv6TransitNetworkAllocation.address,
								prefixLength: ipv6TransitNetworkAllocation.prefixLength
							}
						}
					: {}),
				...(ipv6PrefixNetworkAllocation?.prefix
					? { ipv6Prefix: ipv6PrefixNetworkAllocation.prefix }
					: {})
			},
			sshKeys: publicKeys,
			password: params.password,
			onProvisionSettled: ({ ok, error: err }) => {
				const db = initDrizzle();
				db.update(vms)
					.set(ok ? { status: 'ready' } : { status: 'error', statusError: err ?? 'Unknown error' })
					.where(and(eq(vms.id, vmId), eq(vms.active, true)))
					.then(() => console.log(`VM ${vmId} provision ${ok ? 'succeeded' : 'failed'}`))
					.catch((err) => console.error(`VM ${vmId} status update failed:`, err));
			},
			userId: event.locals.user.id,
			projectId: params.projectId
		});

		if (!result.macAddress) error(502, 'Proxmox did not return a MAC address');
	} catch (err) {
		if (result?.proxmoxId != null) {
			await getBackend('proxmox')
				.deleteVm(vmId, result.proxmoxId)
				.catch((deleteErr) => {
					console.warn(`Failed to clean up Proxmox VM ${vmId} after provisioning error`, deleteErr);
				});
		}
		await releaseVmNetworking(db, vmId).catch(() => {});
		await deleteProjectServerEntity(params.projectId, vmId).catch(() => {});
		await db
			.delete(vms)
			.where(eq(vms.id, inserted.id))
			.catch(() => {});
		throw err;
	}

	const ipv4Allocation = networkingAllocations.find((allocation) => allocation.family === 'ipv4');
	const ipv6Allocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv6' && allocation.address
	);

	await db
		.update(vms)
		.set({
			proxmoxId: result.proxmoxId ?? null,
			lastKnownIpv4: ipv4Allocation?.address ?? null,
			lastKnownIpv6: ipv6Allocation?.address ?? null
		})
		.where(eq(vms.id, vmId));
	await createBillingMeter({
		projectId: params.projectId,
		resourceType: 'vm',
		resourceId: vmId,
		featureId,
		units: 1,
		now
	});

	return { id: inserted.id, taskId: result.taskId };
});

const deleteParams = type({ vmId: 'string' });
export const deleteVm = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (!row.active) return;
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId, 'admin');
	}
	try {
		await getBackend(row.backend).deleteVm(row.id, row.proxmoxId ?? undefined);
	} catch (err) {
		console.warn(`Failed to delete backend VM ${row.id}`, err);
		error(502, `Failed to deprovision VM "${row.name}" in Proxmox`);
	}

	const metered = await meterResourceThrough('vm', row.id);
	if (row.ownerProjectId && (!metered?.event || metered.syncStatus === 'synced')) {
		await deleteProjectServerEntity(row.ownerProjectId, row.id).catch((err) => {
			console.warn(`Failed to delete Autumn entity for VM ${row.id}`, err);
		});
	}

	await releaseVmNetworking(db, row.id).catch((err) => {
		console.warn(`Failed to release networking for VM ${row.id}`, err);
	});

	await db.update(vms).set({ active: false }).where(eq(vms.id, params.vmId));
});

const powerParams = type({ vmId: 'string' });
async function powerAction(vmId: string, action: 'startVm' | 'stopVm' | 'killVm' | 'rebootVm') {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, vmId) });
	if (!row) error(404, `VM "${vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId, 'read_write');
	}

	const backend = getBackend(row.backend);
	await backend[action](row.id, row.proxmoxId ?? undefined);
}

export const startVm = command(powerParams, async (p) => powerAction(p.vmId, 'startVm'));
export const stopVm = command(powerParams, async (p) => powerAction(p.vmId, 'stopVm'));
export const killVm = command(powerParams, async (p) => powerAction(p.vmId, 'killVm'));
export const rebootVm = command(powerParams, async (p) => powerAction(p.vmId, 'rebootVm'));
