import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import { member, organization, user, vms, vmTypes } from '$lib/server/db/schema';
import { getBackend, type VmInfo } from '$lib/server/backends';
import { queueVmDeletion } from '$lib/server/vm-deletion';

export type AdminVm = {
	id: string;
	name: string;
	proxmoxId: number | null;
	active: boolean;
	status: 'provisioning' | 'ready' | 'error' | 'deleting';
	statusError: string | null;
	liveStatus: string | null;
	uptime: number;
	createdAt: number;
	lastKnownIpv4: string | null;
	lastKnownIpv6: string | null;
	projectId: string | null;
	projectName: string | null;
	ownerName: string | null;
	ownerEmail: string | null;
	ownerBillingExempt: boolean;
	vmTypeName: string | null;
	vmTypeCores: number | null;
	vmTypeRamCapacity: number | null;
	vmTypeStorageAmount: number | null;
};

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

export const listAllAdminVms = query(async (): Promise<AdminVm[]> => {
	const db = await requireCurrentAdmin();

	const [rows, owners] = await Promise.all([
		db
			.select({
				id: vms.id,
				name: vms.name,
				proxmoxId: vms.proxmoxId,
				active: vms.active,
				status: vms.status,
				statusError: vms.statusError,
				lastKnownStatus: vms.lastKnownStatus,
				lastKnownUptime: vms.lastKnownUptime,
				createdAt: vms.createdAt,
				lastKnownIpv4: vms.lastKnownIpv4,
				lastKnownIpv6: vms.lastKnownIpv6,
				projectId: vms.ownerProjectId,
				projectName: organization.name,
				vmTypeName: vmTypes.name,
				vmTypeCores: vmTypes.cores,
				vmTypeRamCapacity: vmTypes.ramCapacity,
				vmTypeStorageAmount: vmTypes.storageAmount
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
		liveVms = await getBackend('proxmox').listVms();
	} catch (err) {
		console.warn('Failed to load Proxmox VM statuses', err);
	}
	const liveByProxmoxId = new Map(
		liveVms.filter((vm) => vm.proxmoxId != null).map((vm) => [vm.proxmoxId!, vm] as const)
	);
	const ownerByProject = new Map(owners.map((owner) => [owner.organizationId, owner]));

	return rows.map((row) => {
		const live = row.proxmoxId != null ? liveByProxmoxId.get(row.proxmoxId) : null;
		const owner = row.projectId ? ownerByProject.get(row.projectId) : null;

		return {
			id: row.id,
			name: row.name,
			proxmoxId: row.proxmoxId,
			active: row.active,
			status: row.status,
			statusError: row.statusError,
			liveStatus: row.active ? (live?.status ?? row.lastKnownStatus) : null,
			uptime: live?.uptime ?? row.lastKnownUptime ?? 0,
			createdAt: row.createdAt,
			lastKnownIpv4: row.lastKnownIpv4,
			lastKnownIpv6: row.lastKnownIpv6,
			projectId: row.projectId,
			projectName: row.projectName,
			ownerName: owner?.name ?? null,
			ownerEmail: owner?.email ?? null,
			ownerBillingExempt: owner?.billingExempt ?? false,
			vmTypeName: row.vmTypeName,
			vmTypeCores: row.vmTypeCores,
			vmTypeRamCapacity: row.vmTypeRamCapacity,
			vmTypeStorageAmount: row.vmTypeStorageAmount
		};
	});
});

const powerParams = type({ vmId: 'string' });

async function adminPowerAction(
	vmId: string,
	action: 'startVm' | 'stopVm' | 'killVm' | 'rebootVm'
) {
	const db = await requireCurrentAdmin();

	const row = await db.query.vms.findFirst({ where: eq(vms.id, vmId) });
	if (!row) error(404, `VM "${vmId}" not found`);
	if (!row.active) error(400, `VM "${row.name}" is no longer active`);
	if (row.status === 'deleting') error(409, `VM "${row.name}" is being deleted`);

	await getBackend(row.backend)[action](row.id, row.proxmoxId ?? undefined);
}

export const adminStartVm = command(powerParams, async (p) => adminPowerAction(p.vmId, 'startVm'));
export const adminStopVm = command(powerParams, async (p) => adminPowerAction(p.vmId, 'stopVm'));
export const adminKillVm = command(powerParams, async (p) => adminPowerAction(p.vmId, 'killVm'));
export const adminRebootVm = command(powerParams, async (p) =>
	adminPowerAction(p.vmId, 'rebootVm')
);

export const adminDeleteVm = command(powerParams, async (params) => {
	const db = await requireCurrentAdmin();

	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (!row.active) return;
	if (row.status === 'deleting') return;

	await queueVmDeletion(db, row);
});
