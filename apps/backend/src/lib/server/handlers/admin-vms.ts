import { desc, eq, sql } from 'drizzle-orm';
import type { VmLifecycleStatus, VmPowerState } from 'stack-shared/vm-status';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { proxmox, type VmInfo, type VmPowerAction } from '#lib/server/backends/index.js';
import { findLiveVm } from '#lib/server/backends/proxmox/index.js';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import { vms, vmTypes } from '#lib/server/db/schema.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { assertPowerable, requireVm } from '#lib/server/vm-access.js';
import { queueVmDeletion } from '#lib/server/vm-deletion.js';

export interface AdminVm {
	active: boolean;
	cpuUsage: number | null;
	createdAt: number;
	deletedAt: number | null;
	id: string;
	lastKnownAt: number | null;
	lastKnownIpv4: string | null;
	lastKnownIpv6: string | null;
	liveStatus: VmPowerState | null;
	memoryTotalBytes: number | null;
	memoryUsageBytes: number | null;
	name: string;
	ownerBillingExempt: boolean;
	ownerEmail: string | null;
	ownerName: string | null;
	projectBillingExempt: boolean;
	projectId: string | null;
	projectName: string | null;
	proxmoxId: number | null;
	proxmoxNode: string | null;
	status: VmLifecycleStatus;
	statusError: string | null;
	uptime: number;
	vmTypeCores: number | null;
	vmTypeName: string | null;
	vmTypeRamCapacity: number | null;
	vmTypeRate: string | null;
	vmTypeStorageAmount: number | null;
}

export interface AdminVmInput {
	vmId: string;
}

export interface AdminPowerVmInput extends AdminVmInput {
	action: VmPowerAction;
}

type LiveState = Pick<AdminVm, 'liveStatus' | 'cpuUsage' | 'memoryUsageBytes' | 'memoryTotalBytes'>;

function describeLiveState(
	active: boolean,
	live: VmInfo | null,
	lastKnownStatus: VmPowerState | null
): LiveState {
	if (!active) {
		return { liveStatus: null, cpuUsage: null, memoryUsageBytes: null, memoryTotalBytes: null };
	}
	return {
		liveStatus: live?.status ?? lastKnownStatus,
		cpuUsage: live?.metrics?.cpu ?? null,
		memoryUsageBytes: live?.metrics?.memory ?? null,
		memoryTotalBytes: live?.memory ?? null
	};
}

export async function listAllAdminVms(): Promise<AdminVm[]> {
	const { db } = await requireAdminUser();

	const [rows, owners] = await Promise.all([
		db
			.select({
				id: vms.id,
				name: vms.name,
				proxmoxId: vms.proxmoxId,
				proxmoxNode: vms.proxmoxNode,
				active: vms.active,
				status: vms.status,
				statusError: vms.statusError,
				lastKnownStatus: sql<VmPowerState | null>`${vms.lastKnownStatus}`,
				lastKnownUptime: vms.lastKnownUptime,
				lastKnownAt: vms.lastKnownAt,
				createdAt: vms.createdAt,
				deletedAt: vms.deletedAt,
				lastKnownIpv4: vms.lastKnownIpv4,
				lastKnownIpv6: vms.lastKnownIpv6,
				projectId: vms.ownerProjectId,
				projectName: organization.name,
				projectBillingExempt: organization.billingExempt,
				vmTypeName: vmTypes.name,
				vmTypeCores: vmTypes.cores,
				vmTypeRamCapacity: vmTypes.ramCapacity,
				vmTypeStorageAmount: vmTypes.storageAmount,
				vmTypeRate: vmTypes.rate
			})
			.from(vms)
			.leftJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
			.leftJoin(organization, eq(organization.id, vms.ownerProjectId))
			.orderBy(desc(vms.createdAt)),
		db
			.select({
				organizationId: member.organizationId,
				name: user.name,
				email: user.email,
				billingExempt: user.billingExempt
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(eq(member.role, 'owner'))
	]);

	let liveVms: VmInfo[] = [];
	try {
		liveVms = await proxmox().listVms();
	} catch (err) {
		console.warn('Failed to load Proxmox VM statuses', err);
	}
	const ownerByProject = new Map(owners.map((owner) => [owner.organizationId, owner]));

	const now = Date.now();
	return rows.map((row) => {
		const live = findLiveVm(liveVms, row);
		const owner = row.projectId ? ownerByProject.get(row.projectId) : null;

		return {
			id: row.id,
			name: row.name,
			proxmoxId: row.proxmoxId,
			proxmoxNode: live?.proxmoxNode ?? row.proxmoxNode,
			active: row.active,
			status: row.status,
			statusError: row.statusError,
			...describeLiveState(row.active, live, row.lastKnownStatus),
			uptime: live?.uptime ?? row.lastKnownUptime ?? 0,
			createdAt: row.createdAt,
			deletedAt: row.deletedAt,
			lastKnownAt: live ? now : row.lastKnownAt,
			lastKnownIpv4: row.lastKnownIpv4,
			lastKnownIpv6: row.lastKnownIpv6,
			projectId: row.projectId,
			projectName: row.projectName,
			projectBillingExempt: row.projectBillingExempt ?? false,
			ownerName: owner?.name ?? null,
			ownerEmail: owner?.email ?? null,
			ownerBillingExempt: owner?.billingExempt ?? false,
			vmTypeName: row.vmTypeName,
			vmTypeCores: row.vmTypeCores,
			vmTypeRamCapacity: row.vmTypeRamCapacity,
			vmTypeStorageAmount: row.vmTypeStorageAmount,
			vmTypeRate: row.vmTypeRate
		};
	});
}

export async function adminPowerVm(params: AdminPowerVmInput) {
	const { db } = await requireAdminUser();
	const row = await requireVm(db, params.vmId);
	assertPowerable(row);

	await proxmox()[params.action](row.id, row.proxmoxId ?? undefined);
	captureServerEvent(
		'admin_vm_power_action',
		{ vm_id: row.id, action: params.action },
		{ projectId: row.ownerProjectId }
	);
}

export async function adminDeleteVm(params: AdminVmInput) {
	const { db } = await requireAdminUser();
	const row = await requireVm(db, params.vmId);
	if (!row.active) {
		return;
	}

	await queueVmDeletion(db, row);
	captureServerEvent('admin_vm_deleted', { vm_id: row.id }, { projectId: row.ownerProjectId });
}
