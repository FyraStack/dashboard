import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer
} from '#lib/server/billing/autumn.js';
import {
	abandonProjectUsageEvents,
	closeProjectMeters,
	syncProjectUsage
} from '#lib/server/billing/metering.js';
import { invitation, organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import {
	billingUsageEvents,
	ipAssignments,
	paymentPeriods,
	projectBillingCustomers,
	vms,
	volumes
} from '#lib/server/db/schema.js';
import { queueVmDeletion } from '#lib/server/vm-deletion.js';

export const DELETED_PROJECT_RETENTION_DAYS = 90;

export async function softDeleteOrganizationResources(
	db: ReturnType<typeof initDrizzle>,
	organizationId: string
) {
	const undeletedVms = await db.query.vms.findMany({
		where: and(
			eq(vms.ownerProjectId, organizationId),
			eq(vms.active, true),
			ne(vms.status, 'deleting')
		),
		columns: { id: true, backend: true, ownerProjectId: true, proxmoxId: true }
	});
	for (const vm of undeletedVms) {
		// biome-ignore lint/performance/noAwaitInLoops: each VM's final usage is metered one at a time so project usage caps are applied in order
		await queueVmDeletion(db, vm);
	}
	await syncProjectUsage(organizationId);

	const now = Date.now();
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
		// biome-ignore lint/performance/noAwaitInLoops: each project purge is a multi-step delete run one project at a time to bound database load
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
		if (unsettled) {
			continue;
		}

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
