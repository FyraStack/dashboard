import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { getBackend } from '$lib/server/backends';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer,
	deleteProjectServerEntity
} from '$lib/server/billing/autumn';
import {
	abandonProjectUsageEvents,
	closeProjectMeters,
	meterResourceThrough,
	syncProjectUsage
} from '$lib/server/billing/metering';
import { initDrizzle } from '$lib/server/db';
import {
	billingUsageEvents,
	invitation,
	ipAssignments,
	organization,
	paymentPeriods,
	projectBillingCustomers,
	volumes,
	vms
} from '$lib/server/db/schema';
import { releaseVmNetworking } from '$lib/server/ipam';

export const DELETED_PROJECT_RETENTION_DAYS = 90;

export async function softDeleteOrganizationResources(
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
			return null;
		});
		if (!metered?.event || metered.syncStatus === 'synced') {
			await deleteProjectServerEntity(organizationId, vm.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${vm.id}`, err);
			});
		}
	}
	await syncProjectUsage(organizationId);

	for (const vm of projectVms) {
		await releaseVmNetworking(db, vm.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${vm.id} during project delete`, err);
		});
	}

	const now = Date.now();
	await db
		.update(vms)
		.set({ active: false, deletedAt: now })
		.where(and(eq(vms.ownerProjectId, organizationId), isNull(vms.deletedAt)));

	await closeProjectMeters(organizationId, now);

	const billingCancelled = await cancelProjectBilling(organizationId).catch((err) => {
		console.warn(`Failed to cancel Autumn billing for project ${organizationId}`, err);
		return false;
	});
	if (billingCancelled) {
		await deleteLocalProjectBillingCustomer(organizationId);
	}
	await abandonProjectUsageEvents(organizationId, 'Project deleted');

	await db.delete(invitation).where(eq(invitation.organizationId, organizationId));
	await db
		.update(organization)
		.set({ deletedAt: now, slug: `deleted-${organizationId}` })
		.where(eq(organization.id, organizationId));
}

export async function purgeExpiredDeletedOrganizations(now = Date.now(), limit = 25) {
	const db = initDrizzle();
	const cutoff = now - DELETED_PROJECT_RETENTION_DAYS * 86_400_000;
	const expired = await db
		.select({ id: organization.id })
		.from(organization)
		.where(and(isNotNull(organization.deletedAt), lt(organization.deletedAt, cutoff)))
		.limit(limit);

	let purged = 0;
	for (const { id } of expired) {
		const [unsettled] = await db
			.select({ id: billingUsageEvents.id })
			.from(billingUsageEvents)
			.where(
				and(
					eq(billingUsageEvents.projectId, id),
					inArray(billingUsageEvents.syncStatus, ['pending', 'failed'])
				)
			)
			.limit(1);
		if (unsettled) continue;

		const projectVms = await db.select({ id: vms.id }).from(vms).where(eq(vms.ownerProjectId, id));
		const vmIds = projectVms.map((vm) => vm.id);
		if (vmIds.length > 0) {
			await db
				.update(volumes)
				.set({ associatedVmId: null })
				.where(inArray(volumes.associatedVmId, vmIds));
			await db.delete(ipAssignments).where(inArray(ipAssignments.associatedVmId, vmIds));
			await db.delete(paymentPeriods).where(inArray(paymentPeriods.vmId, vmIds));
			await db.delete(vms).where(inArray(vms.id, vmIds));
		}
		await db.delete(volumes).where(eq(volumes.ownerProjectId, id));
		await db.delete(projectBillingCustomers).where(eq(projectBillingCustomers.projectId, id));
		await db.delete(organization).where(eq(organization.id, id));
		purged += 1;
	}

	return { purged };
}
