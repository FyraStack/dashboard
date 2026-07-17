import { error } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { getBackend } from '$lib/server/backends';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer,
	deleteProjectServerEntity
} from '$lib/server/billing/autumn';
import { meterResourceThrough, syncProjectUsage } from '$lib/server/billing/metering';
import type { initDrizzle } from '$lib/server/db';
import {
	invitation,
	ipAssignments,
	member,
	organization,
	paymentPeriods,
	volumes,
	vms
} from '$lib/server/db/schema';
import { releaseVmNetworking } from '$lib/server/ipam';

export async function deleteOrganizationResources(
	db: ReturnType<typeof initDrizzle>,
	organizationId: string
) {
	const projectVms = await db.query.vms.findMany({
		where: eq(vms.ownerProjectId, organizationId),
		columns: {
			id: true,
			name: true,
			proxmoxId: true,
			active: true,
			backend: true
		}
	});
	const vmIds = projectVms.map((vm) => vm.id);

	for (const vm of projectVms.filter((item) => item.active)) {
		try {
			await getBackend(vm.backend).deleteVm(vm.id, vm.proxmoxId ?? undefined);
		} catch (err) {
			console.warn(`Failed to deprovision VM ${vm.id} during project delete`, err);
			error(502, `Failed to deprovision VM "${vm.name}" in Proxmox`);
		}
	}

	for (const vm of projectVms.filter((item) => item.active)) {
		const metered = await meterResourceThrough('vm', vm.id).catch((err) => {
			console.warn(`Failed to meter VM ${vm.id} during project delete`, err);
			error(502, `Failed to meter VM "${vm.name}" during project delete`);
		});
		if (!metered?.event || metered.syncStatus === 'synced') {
			await deleteProjectServerEntity(organizationId, vm.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${vm.id}`, err);
			});
		}
	}
	await syncProjectUsage(organizationId);

	await db.delete(volumes).where(eq(volumes.ownerProjectId, organizationId));
	for (const vm of projectVms) {
		await releaseVmNetworking(db, vm.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${vm.id} during project delete`, err);
		});
	}
	if (vmIds.length > 0) {
		await db.delete(ipAssignments).where(inArray(ipAssignments.associatedVmId, vmIds));
		await db.delete(paymentPeriods).where(inArray(paymentPeriods.vmId, vmIds));
	}
	await db
		.update(vms)
		.set({ active: false, deletedAt: Date.now(), ownerProjectId: null })
		.where(eq(vms.ownerProjectId, organizationId));
	await db.delete(invitation).where(eq(invitation.organizationId, organizationId));
	await db.delete(member).where(eq(member.organizationId, organizationId));
	const billingCancelled = await cancelProjectBilling(organizationId).catch((err) => {
		console.warn(`Failed to cancel Autumn billing for project ${organizationId}`, err);
		return false;
	});
	if (billingCancelled) {
		await deleteLocalProjectBillingCustomer(organizationId);
	}
	await db.delete(organization).where(eq(organization.id, organizationId));
}
