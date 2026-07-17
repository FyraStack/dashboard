import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq, sql } from 'drizzle-orm';
import { initDrizzle, type Database } from '$lib/server/db';
import { runInBackground } from '$lib/server/background';
import { vms, vmTypes, sshKeys } from '$lib/server/db/schema';
import {
	getBackend,
	type VmBackend,
	type VmInfo,
	type VmMetricsTimeframe
} from '$lib/server/backends';
import { requireProjectAccess } from '$lib/server/auth-context';
import { isProjectBillingExempt, requireProjectBillingActive } from '$lib/server/billing/autumn';
import { queueVmDeletion } from '$lib/server/vm-deletion';
import { provisionVm } from '$lib/server/vm-provisioning';
import { instrument, timingLog } from '$lib/server/observability';

type VmRow = {
	id: string;
	name: string;
	proxmoxId: number | null;
	proxmoxNode: string | null;
	active: boolean;
	ownerProjectId: string | null;
	vmTypeId: string;
	creationDate: string;
	createdAt: number;
	backend: 'proxmox';
	status: 'provisioning' | 'ready' | 'error' | 'deleting';
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

function getKnownNetworkInterfaces(row: VmRow): VmInfo['networkInterfaces'] | undefined {
	if (!row.lastKnownIpv4 && !row.lastKnownIpv6) return undefined;

	return {
		cached: {
			ipAddresses: [row.lastKnownIpv4, row.lastKnownIpv6].filter(Boolean) as string[]
		}
	};
}

function getKnownLive(row: VmRow): VmInfo | null {
	if (!row.lastKnownStatus && !row.lastKnownIpv4 && !row.lastKnownIpv6) return null;

	return {
		id: row.name,
		proxmoxId: row.proxmoxId ?? undefined,
		proxmoxNode: row.proxmoxNode ?? undefined,
		name: row.name,
		status: row.lastKnownStatus ?? 'unknown',
		cores: row.vmTypeCores ?? 0,
		memory: (row.vmTypeRamCapacity ?? 0) * 1024 * 1024,
		disk: (row.vmTypeStorageAmount ?? 0) * 1024 * 1024 * 1024,
		uptime: row.lastKnownUptime ?? 0,
		networkInterfaces: getKnownNetworkInterfaces(row),
		metrics: undefined
	};
}

function mergeKnownLive(row: VmRow, live: VmInfo | null): VmInfo | null {
	if (!live) return getKnownLive(row);
	if (live.networkInterfaces) return live;

	const networkInterfaces = getKnownNetworkInterfaces(row);
	return networkInterfaces ? { ...live, networkInterfaces } : live;
}

function getNetworkIpSnapshot(networkInterfaces: VmInfo['networkInterfaces'] | undefined) {
	const addresses = Object.values(networkInterfaces ?? {})
		.flatMap((iface) => iface.ipAddresses ?? [])
		.filter((address) => !address.startsWith('127.') && address !== '::1');

	return {
		ipv4: addresses.find((address) => !address.includes(':')) ?? null,
		ipv6: addresses.find((address) => address.includes(':')) ?? null
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
		live: mergeKnownLive(row, live)
	};
}

function toDashboardStatus(
	status: VmRow['status'],
	liveStatus: VmInfo['status'] | null | undefined
): 'running' | 'stopped' | 'restarting' | 'provisioning' | 'deleting' | 'unknown' {
	if (status === 'deleting') return 'deleting';
	if (liveStatus === 'running') return 'running';
	if (liveStatus === 'paused') return 'restarting';
	if (status === 'provisioning') return 'provisioning';
	if (liveStatus === 'stopped') return 'stopped';
	return 'unknown';
}

const persistableStatuses: VmInfo['status'][] = ['running', 'stopped', 'paused'];

function persistLiveState(db: Database, entries: { id: string; live: VmInfo }[]): void {
	const persistable = entries.filter((entry) => persistableStatuses.includes(entry.live.status));
	if (persistable.length === 0) return;

	const now = Date.now();
	const work = instrument(
		'vm.persistLiveState',
		() =>
			Promise.all(
				persistable.map((entry) => {
					const ips = getNetworkIpSnapshot(entry.live.networkInterfaces);
					return db
						.update(vms)
						.set({
							lastKnownStatus: entry.live.status,
							lastKnownUptime: Math.round(entry.live.uptime ?? 0),
							lastKnownAt: now,
							...(entry.live.proxmoxNode ? { proxmoxNode: entry.live.proxmoxNode } : {}),
							...(ips.ipv4 ? { lastKnownIpv4: ips.ipv4 } : {}),
							...(ips.ipv6 ? { lastKnownIpv6: ips.ipv6 } : {})
						})
						.where(eq(vms.id, entry.id));
				})
			).then(() => undefined),
		{ 'vm.persist.count': persistable.length }
	);
	runInBackground(work, 'persist vm live state');
}

function refreshVmNetworkInterfaces(db: Database, row: VmRow, backend: VmBackend): void {
	if (!backend.getVmNetworkInterfaces || row.proxmoxId == null) return;

	const work = instrument(
		'vm.refreshNetworkInterfaces',
		async () => {
			const networkInterfaces = await backend.getVmNetworkInterfaces?.(
				row.id,
				row.proxmoxId ?? undefined,
				{ proxmoxNode: row.proxmoxNode ?? undefined }
			);
			const ips = getNetworkIpSnapshot(networkInterfaces);
			if (!ips.ipv4 && !ips.ipv6) return;

			await db
				.update(vms)
				.set({
					...(ips.ipv4 ? { lastKnownIpv4: ips.ipv4 } : {}),
					...(ips.ipv6 ? { lastKnownIpv6: ips.ipv6 } : {}),
					lastKnownAt: Date.now()
				})
				.where(eq(vms.id, row.id));
		},
		{ 'vm.id': row.id, 'vm.proxmox_id': row.proxmoxId ?? undefined }
	);
	runInBackground(work, `refresh vm network interfaces ${row.id}`);
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
			${vms.proxmoxNode} as "proxmoxNode",
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
	const started = performance.now();
	timingLog('remote.vms.getVm.enter', { 'vm.id': params.vmId });
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const result = await db.execute(sql`
		select
			${vms.id} as id,
			${vms.name} as name,
			${vms.proxmoxId} as "proxmoxId",
			${vms.proxmoxNode} as "proxmoxNode",
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
	timingLog('remote.vms.getVm.db.end', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId);
	}

	let live: VmInfo | null = null;
	try {
		const backend = getBackend(row.backend);
		live = await instrument(
			'remote.vms.getVm.backend',
			() =>
				backend.getVm(row.id, row.proxmoxId ?? undefined, {
					proxmoxNode: row.proxmoxNode ?? undefined,
					includeNetworkInterfaces: false
				}),
			{
				'vm.backend': row.backend,
				'vm.proxmox_id': row.proxmoxId ?? undefined,
				'proxmox.node_hint': row.proxmoxNode ?? undefined
			}
		);
		if (live.status === 'running') refreshVmNetworkInterfaces(db, row, backend);
	} catch (err) {
		console.warn(`Failed to load live VM state for ${row.id}`, err);
		if (
			row.active &&
			row.status === 'deleting' &&
			err instanceof Error &&
			err.message.includes('not found on any Proxmox node')
		) {
			await queueVmDeletion(db, row);
		}
	}

	if (live) persistLiveState(db, [{ id: row.id, live }]);

	timingLog('remote.vms.getVm.exit', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	return mapVmRow(row, live);
});

const metricsHistoryParams = type({
	vmId: 'string',
	timeframe: "'hour' | 'day' | 'week' | 'month' | 'year'?"
});
export const getVmMetricsHistory = query(metricsHistoryParams, async (params) => {
	const started = performance.now();
	timingLog('remote.vms.getVmMetricsHistory.enter', {
		'vm.id': params.vmId,
		'vm.metrics.timeframe': params.timeframe ?? 'hour'
	});
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	timingLog('remote.vms.getVmMetricsHistory.db.end', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId);
	}

	try {
		const backend = getBackend(row.backend);
		const samples = await instrument(
			'remote.vms.getVmMetricsHistory.backend',
			() =>
				backend.getVmMetricsHistory(
					row.id,
					row.proxmoxId ?? undefined,
					(params.timeframe ?? 'hour') as VmMetricsTimeframe,
					{ proxmoxNode: row.proxmoxNode ?? undefined }
				),
			{
				'vm.backend': row.backend,
				'vm.proxmox_id': row.proxmoxId ?? undefined,
				'proxmox.node_hint': row.proxmoxNode ?? undefined,
				'vm.metrics.timeframe': params.timeframe ?? 'hour'
			}
		);
		timingLog('remote.vms.getVmMetricsHistory.exit', {
			'vm.id': params.vmId,
			'vm.metrics.count': samples.length,
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return samples;
	} catch (err) {
		console.warn(`Failed to load VM metrics history for ${row.id}`, err);
		timingLog('remote.vms.getVmMetricsHistory.error', {
			'vm.id': params.vmId,
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return [];
	}
});

const statusParams = type({ projectId: 'string' });
export const listVmStatuses = query(statusParams, async (params) => {
	const started = performance.now();
	timingLog('remote.vms.listVmStatuses.enter', { 'project.id': params.projectId });
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const result = await db.execute(sql`
		select
			${vms.id} as id,
			${vms.name} as name,
			${vms.proxmoxId} as "proxmoxId",
			${vms.proxmoxNode} as "proxmoxNode",
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
	timingLog('remote.vms.listVmStatuses.db.end', {
		'project.id': params.projectId,
		'vm.status.project_active_count': rows.length,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	let liveVms: VmInfo[] = [];
	let liveListLoaded = false;
	try {
		const backend = getBackend('proxmox');
		liveVms = await instrument('remote.vms.listVmStatuses.backend', () => backend.listVms(), {
			'vm.status.project_active_count': rows.length
		});
		liveListLoaded = true;
	} catch (err) {
		console.warn('Failed to load live Proxmox VM statuses', err);
	}

	const liveByProxmoxId = new Map(
		liveVms.filter((vm) => vm.proxmoxId != null).map((vm) => [vm.proxmoxId!, vm] as const)
	);
	const liveById = new Map(liveVms.map((vm) => [vm.id, vm]));

	if (liveListLoaded) {
		const staleDeleting = rows.filter(
			(row) =>
				row.status === 'deleting' &&
				!(row.proxmoxId != null ? liveByProxmoxId.get(row.proxmoxId) : null) &&
				!liveById.get(row.id)
		);
		for (const row of staleDeleting) {
			await queueVmDeletion(db, row).catch((err) => {
				console.warn(`Failed to re-queue deletion for VM ${row.id}`, err);
			});
		}
	}

	const persistable: { id: string; live: VmInfo }[] = [];
	const statuses = rows.map((row) => {
		const live =
			(row.proxmoxId != null ? liveByProxmoxId.get(row.proxmoxId) : null) ??
			liveById.get(row.id) ??
			null;
		if (live) persistable.push({ id: row.id, live });
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

	persistLiveState(db, persistable);

	timingLog('remote.vms.listVmStatuses.exit', {
		'project.id': params.projectId,
		'vm.status.count': statuses.length,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	return statuses;
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
	const billingExempt = await isProjectBillingExempt(params.projectId);
	if (!billingExempt) await requireProjectBillingActive(params.projectId);

	const keys = params.sshKeyIds?.length
		? await db.query.sshKeys.findMany({
				where: eq(sshKeys.userId, event.locals.user.id)
			})
		: [];
	const publicKeys = params.sshKeyIds?.length
		? keys.filter((key) => params.sshKeyIds!.includes(key.id)).map((key) => key.publicKey)
		: [];

	return provisionVm(db, {
		projectId: params.projectId,
		vmTypeId: params.vmTypeId,
		name: params.name,
		userId: event.locals.user.id,
		billingExempt,
		networkingMode: params.networkingMode,
		imageId: params.imageId,
		sshPublicKeys: publicKeys,
		password: params.password
	});
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
	if (row.status === 'deleting') return;

	await queueVmDeletion(db, row);
});

const powerParams = type({ vmId: 'string' });
async function powerAction(vmId: string, action: 'startVm' | 'stopVm' | 'killVm' | 'rebootVm') {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, vmId) });
	if (!row) error(404, `VM "${vmId}" not found`);
	if (row.status === 'deleting') error(409, `VM "${row.name}" is being deleted`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, row.ownerProjectId, 'read_write');
		if (action === 'startVm' || action === 'rebootVm') {
			await requireProjectBillingActive(row.ownerProjectId);
		}
	}

	const backend = getBackend(row.backend);
	await backend[action](row.id, row.proxmoxId ?? undefined);
}

export const startVm = command(powerParams, async (p) => powerAction(p.vmId, 'startVm'));
export const stopVm = command(powerParams, async (p) => powerAction(p.vmId, 'stopVm'));
export const killVm = command(powerParams, async (p) => powerAction(p.vmId, 'killVm'));
export const rebootVm = command(powerParams, async (p) => powerAction(p.vmId, 'rebootVm'));
