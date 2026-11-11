import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { MetricsTimeframe } from 'stack-shared/compute';
import { isValidPtrHostname } from 'stack-shared/ptr';
import { findPlanDowngrades } from 'stack-shared/vm-plans';
import { toServerStatus } from 'stack-shared/vm-status';
import { requireProjectAccess, requireUser } from '#lib/server/auth-context.js';
import { proxmox, type VmInfo, type VmPowerAction } from '#lib/server/backends/index.js';
import { findLiveVm } from '#lib/server/backends/proxmox/index.js';
import { VmResizeError } from '#lib/server/backends/types.js';
import { runInBackground } from '#lib/server/background.js';
import { isBillingConfigured } from '#lib/server/billing/autumn.js';
import { requireProjectBillingActive } from '#lib/server/billing/state.js';
import type { Database } from '#lib/server/db/index.js';
import { ipamAllocations, vms, vmTypes } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { instrument, timingLog } from '#lib/server/observability.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import {
	assertMutable,
	assertPowerable,
	requireAccessibleVm,
	requireVmAccess
} from '#lib/server/vm-access.js';
import { queueVmDeletion } from '#lib/server/vm-deletion.js';
import { provisionRequestedVm, type RequestedVm } from '#lib/server/vm-provisioning.js';

function selectVmRows(db: Database, where: SQL | undefined) {
	return db
		.select({
			id: vms.id,
			name: vms.name,
			proxmoxId: vms.proxmoxId,
			proxmoxNode: vms.proxmoxNode,
			active: vms.active,
			ownerProjectId: vms.ownerProjectId,
			vmTypeId: vms.vmTypeId,
			creationDate: vms.creationDate,
			status: vms.status,
			lastKnownIpv4: vms.lastKnownIpv4,
			lastKnownIpv6: vms.lastKnownIpv6,
			lastKnownStatus: sql<VmInfo['status'] | null>`${vms.lastKnownStatus}`,
			lastKnownUptime: vms.lastKnownUptime,
			vmTypeName: vmTypes.name,
			vmTypeCores: vmTypes.cores,
			vmTypeRamCapacity: vmTypes.ramCapacity,
			vmTypeStorageAmount: vmTypes.storageAmount
		})
		.from(vms)
		.leftJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.where(where);
}

type VmRow = Awaited<ReturnType<typeof selectVmRows>>[number];

function getKnownNetworkInterfaces(row: VmRow): VmInfo['networkInterfaces'] | undefined {
	if (!(row.lastKnownIpv4 || row.lastKnownIpv6)) {
		return undefined;
	}

	return {
		cached: {
			ipAddresses: [row.lastKnownIpv4, row.lastKnownIpv6].filter(Boolean) as string[]
		}
	};
}

function baseKnownLive(row: VmRow): VmInfo {
	return {
		id: row.name,
		proxmoxId: row.proxmoxId ?? undefined,
		proxmoxNode: row.proxmoxNode ?? undefined,
		name: row.name,
		status: row.lastKnownStatus ?? 'unknown',
		cores: row.vmTypeCores ?? 0,
		memory: (row.vmTypeRamCapacity ?? 0) * 1024 * 1024,
		disk: (row.vmTypeStorageAmount ?? 0) * 1024 * 1024 * 1024,
		uptime: row.lastKnownUptime,
		networkInterfaces: getKnownNetworkInterfaces(row),
		metrics: undefined
	};
}

function getKnownLive(row: VmRow): VmInfo | null {
	if (!(row.lastKnownStatus || row.lastKnownIpv4 || row.lastKnownIpv6)) {
		return null;
	}
	return baseKnownLive(row);
}

async function getAssignedIps(db: Database, vmIds: string[]): Promise<Map<string, string[]>> {
	const assigned = new Map<string, string[]>();
	if (vmIds.length === 0) {
		return assigned;
	}

	const rows = await db.query.ipamAllocations.findMany({
		where: inArray(ipamAllocations.associatedVmId, vmIds),
		columns: { associatedVmId: true, address: true }
	});

	for (const row of rows) {
		if (!row.address) {
			continue;
		}
		const addresses = assigned.get(row.associatedVmId) ?? [];
		addresses.push(row.address);
		assigned.set(row.associatedVmId, addresses);
	}

	return assigned;
}

function mergeKnownLive(row: VmRow, live: VmInfo | null): VmInfo | null {
	if (!live) {
		return getKnownLive(row);
	}
	if (live.networkInterfaces) {
		return live;
	}

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

function mapVmRow(row: VmRow, liveInput: VmInfo | null, assignedIps?: string[]) {
	let live = mergeKnownLive(row, liveInput);
	if (assignedIps?.length) {
		live = {
			...(live ?? baseKnownLive(row)),
			networkInterfaces: {
				assigned: { ipAddresses: assignedIps },
				...(live?.networkInterfaces ?? {})
			}
		};
	}

	return {
		id: row.id,
		name: row.name,
		proxmoxId: row.proxmoxId ?? undefined,
		active: row.active,
		ownerProjectId: row.ownerProjectId,
		vmTypeId: row.vmTypeId,
		creationDate: row.creationDate,
		status: row.status,
		vmType: row.vmTypeName
			? {
					name: row.vmTypeName,
					cores: row.vmTypeCores ?? 0,
					ramCapacity: row.vmTypeRamCapacity ?? 0,
					storageAmount: row.vmTypeStorageAmount ?? 0
				}
			: null,
		live
	};
}

const persistableStatuses: VmInfo['status'][] = ['running', 'stopped', 'paused'];

function persistLiveState(db: Database, entries: { id: string; live: VmInfo }[]): void {
	const persistable = entries.filter((entry) => persistableStatuses.includes(entry.live.status));
	if (persistable.length === 0) {
		return;
	}

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

function refreshVmNetworkInterfaces(db: Database, row: VmRow): void {
	const { proxmoxId } = row;
	if (proxmoxId === null) {
		return;
	}

	const work = instrument(
		'vm.refreshNetworkInterfaces',
		async () => {
			const networkInterfaces = await proxmox().getVmNetworkInterfaces(row.id, proxmoxId, {
				proxmoxNode: row.proxmoxNode ?? undefined
			});
			const ips = getNetworkIpSnapshot(networkInterfaces);
			if (!(ips.ipv4 || ips.ipv6)) {
				return;
			}

			await db
				.update(vms)
				.set({
					...(ips.ipv4 ? { lastKnownIpv4: ips.ipv4 } : {}),
					...(ips.ipv6 ? { lastKnownIpv6: ips.ipv6 } : {}),
					lastKnownAt: Date.now()
				})
				.where(eq(vms.id, row.id));
		},
		{ 'vm.id': row.id, 'vm.proxmox_id': proxmoxId }
	);
	runInBackground(work, `refresh vm network interfaces ${row.id}`);
}

export interface ListVmsInput {
	projectId: string;
}

export async function listVms(params: ListVmsInput) {
	const { db, user } = requireUser();
	await requireProjectAccess(db, user.id, params.projectId);

	const rows = await selectVmRows(db, eq(vms.ownerProjectId, params.projectId));
	const assignedIps = await getAssignedIps(
		db,
		rows.map((row) => row.id)
	);

	return rows.map((row) => mapVmRow(row, null, assignedIps.get(row.id)));
}

export interface GetVmInput {
	vmId: string;
}

export async function getVm(params: GetVmInput) {
	const started = performance.now();
	timingLog('remote.vms.getVm.enter', { 'vm.id': params.vmId });
	const { db, user } = requireUser();

	const [row] = await selectVmRows(db, eq(vms.id, params.vmId)).limit(1);
	timingLog('remote.vms.getVm.db.end', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	if (!row) {
		error(404, `VM "${params.vmId}" not found`);
	}
	await requireVmAccess(db, user, row);

	const assignedIps = await getAssignedIps(db, [row.id]);

	let live: VmInfo | null = null;
	try {
		live = await instrument(
			'remote.vms.getVm.backend',
			() =>
				proxmox().getVm(row.id, row.proxmoxId ?? undefined, {
					proxmoxNode: row.proxmoxNode ?? undefined
				}),
			{
				'vm.proxmox_id': row.proxmoxId ?? undefined,
				'proxmox.node_hint': row.proxmoxNode ?? undefined
			}
		);
		if (live.status === 'running') {
			refreshVmNetworkInterfaces(db, row);
		}
	} catch (err) {
		console.warn(`Failed to load live VM state for ${row.id}`, err);
	}

	if (live) {
		persistLiveState(db, [{ id: row.id, live }]);
	}

	timingLog('remote.vms.getVm.exit', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	return mapVmRow(row, live, assignedIps.get(row.id));
}

export interface GetVmMetricsHistoryInput {
	timeframe?: MetricsTimeframe;
	vmId: string;
}

export async function getVmMetricsHistory(params: GetVmMetricsHistoryInput) {
	const started = performance.now();
	const timeframe = params.timeframe ?? 'hour';
	timingLog('remote.vms.getVmMetricsHistory.enter', {
		'vm.id': params.vmId,
		'vm.metrics.timeframe': timeframe
	});
	const { db, user } = requireUser();

	const row = await requireAccessibleVm(db, user, params.vmId);
	timingLog('remote.vms.getVmMetricsHistory.db.end', {
		'vm.id': params.vmId,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	try {
		const samples = await instrument(
			'remote.vms.getVmMetricsHistory.backend',
			() =>
				proxmox().getVmMetricsHistory(row.id, row.proxmoxId ?? undefined, timeframe, {
					proxmoxNode: row.proxmoxNode ?? undefined
				}),
			{
				'vm.proxmox_id': row.proxmoxId ?? undefined,
				'proxmox.node_hint': row.proxmoxNode ?? undefined,
				'vm.metrics.timeframe': timeframe
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
}

export interface ListVmStatusesInput {
	projectId: string;
}

export async function listVmStatuses(params: ListVmStatusesInput) {
	const started = performance.now();
	timingLog('remote.vms.listVmStatuses.enter', { 'project.id': params.projectId });
	const { db, user } = requireUser();
	await requireProjectAccess(db, user.id, params.projectId);

	const rows = await selectVmRows(
		db,
		and(eq(vms.ownerProjectId, params.projectId), eq(vms.active, true))
	);
	timingLog('remote.vms.listVmStatuses.db.end', {
		'project.id': params.projectId,
		'vm.status.project_active_count': rows.length,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	let liveVms: VmInfo[] = [];
	try {
		liveVms = await instrument('remote.vms.listVmStatuses.backend', () => proxmox().listVms(), {
			'vm.status.project_active_count': rows.length
		});
	} catch (err) {
		console.warn('Failed to load live Proxmox VM statuses', err);
	}

	const assignedIps = await getAssignedIps(
		db,
		rows.map((row) => row.id)
	);

	const persistable: { id: string; live: VmInfo }[] = [];
	const statuses = rows.map((row) => {
		const live = findLiveVm(liveVms, row);
		if (live) {
			persistable.push({ id: row.id, live });
		}
		const mapped = mapVmRow(row, live, assignedIps.get(row.id));
		return {
			id: mapped.id,
			status: toServerStatus(row.status, mapped.live?.status),
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
}

export interface CreateVmInput extends RequestedVm {
	idempotencyKey: string;
}

export async function createVm(params: CreateVmInput) {
	const { db, user } = requireUser();
	await requireProjectAccess(db, user.id, params.projectId, 'read_write');
	const { billingExempt } = await requireProjectBillingActive(params.projectId);

	const sshKeyIds = params.sshKeyIds ?? [];
	const userId = user.id;
	const { idempotencyKey, ...operationArgs } = params;
	return withIdempotency(
		db,
		{
			key: idempotencyKey,
			operation: 'vms.createVm',
			args: { ...operationArgs, userId, sshKeyIds: [...sshKeyIds].sort() }
		},
		async () => {
			const { created, sshKeyCount } = await provisionRequestedVm(db, params, {
				billingExempt,
				keyOwnerId: userId,
				userId
			});
			captureServerEvent(
				'vm_created',
				{
					vm_type_id: params.vmTypeId,
					networking_mode: params.networkingMode ?? 'both',
					image_id: params.imageId,
					ssh_key_count: sshKeyCount,
					billing_exempt: billingExempt
				},
				{ projectId: params.projectId }
			);
			return created;
		}
	);
}

export interface RenameVmInput {
	name: string;
	updateHostname: boolean;
	vmId: string;
}

export async function renameVm(params: RenameVmInput) {
	const { db, user } = requireUser();
	const row = await requireAccessibleVm(db, user, params.vmId, 'read_write');
	assertMutable(row);

	const name = params.name.trim();
	if (!name) {
		error(400, 'Server name is required');
	}
	if (params.updateHostname && !isValidPtrHostname(name)) {
		error(400, 'Server name must be a valid hostname to update the guest hostname');
	}

	if (params.updateHostname) {
		await proxmox().updateVmHostname(row.id, name, row.proxmoxId ?? undefined);
	}

	await db.update(vms).set({ name }).where(eq(vms.id, row.id));
	captureServerEvent(
		'vm_renamed',
		{ vm_id: row.id, hostname_updated: params.updateHostname },
		{ projectId: row.ownerProjectId }
	);
	return { id: row.id, name };
}

export interface DeleteVmInput {
	vmId: string;
}

export async function deleteVm(params: DeleteVmInput) {
	const { db, user } = requireUser();
	const row = await requireAccessibleVm(db, user, params.vmId, 'admin');
	if (!row.active) {
		return;
	}

	await queueVmDeletion(db, row);
	captureServerEvent(
		'vm_deleted',
		{ vm_id: row.id, vm_type_id: row.vmTypeId },
		{ projectId: row.ownerProjectId }
	);
}

export interface PowerVmInput {
	action: VmPowerAction;
	vmId: string;
}

export async function powerVm(params: PowerVmInput) {
	const { db, user } = requireUser();
	const row = await requireAccessibleVm(db, user, params.vmId, 'read_write');
	assertPowerable(row);
	if (row.ownerProjectId && (params.action === 'startVm' || params.action === 'rebootVm')) {
		await requireProjectBillingActive(row.ownerProjectId);
	}

	await proxmox()[params.action](row.id, row.proxmoxId ?? undefined);
	captureServerEvent(
		'vm_power_action',
		{ vm_id: row.id, action: params.action },
		{ projectId: row.ownerProjectId }
	);
}

export interface ResizeVmInput {
	vmId: string;
	vmTypeId: string;
}

export async function resizeVm(params: ResizeVmInput) {
	const { db, user } = requireUser();
	const row = await requireAccessibleVm(db, user, params.vmId, 'read_write');
	assertMutable(row);
	if (row.ownerProjectId) {
		await requireProjectBillingActive(row.ownerProjectId);
	}

	const target = await db.query.vmTypes.findFirst({ where: eq(vmTypes.id, params.vmTypeId) });
	if (!target) {
		error(400, `VM type "${params.vmTypeId}" not found`);
	}
	if (target.id === row.vmTypeId) {
		error(400, `VM is already on plan "${target.name}"`);
	}
	if (isBillingConfigured() && !target.autumnFeatureId) {
		error(400, `VM type "${target.name}" is missing an Autumn feature ID`);
	}

	const downgrades = findPlanDowngrades(row.vmType, target);
	if (downgrades.length > 0) {
		error(400, `Cannot resize to a smaller plan (${downgrades.join(', ')})`);
	}

	try {
		await proxmox().resizeVm(
			row.id,
			{
				cores: target.cores,
				memoryMb: target.ramCapacity,
				diskGb: target.storageAmount,
				tierName: target.name
			},
			row.proxmoxId ?? undefined
		);
	} catch (err) {
		if (err instanceof VmResizeError) {
			error(400, err.message);
		}
		throw err;
	}

	await db.update(vms).set({ vmTypeId: target.id }).where(eq(vms.id, row.id));
	captureServerEvent(
		'vm_resized',
		{ vm_id: row.id, from_vm_type_id: row.vmTypeId, to_vm_type_id: target.id },
		{ projectId: row.ownerProjectId }
	);

	return { id: row.id, vmTypeId: target.id };
}
