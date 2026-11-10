import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer
} from '#lib/server/billing/customers.js';
import {
	abandonProjectUsageEvents,
	closeProjectMeters,
	syncProjectUsage
} from '#lib/server/billing/metering.js';
import { invitation, organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import {
	billingUsageEvents,
	projectBillingCustomers,
	vms,
	volumes
} from '#lib/server/db/schema.js';
import { DELETED_RETENTION_MS, deleteVmRows, queueVmDeletion } from '#lib/server/vm-deletion.js';

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
		columns: { id: true, ownerProjectId: true, proxmoxId: true }
	});
	for (const vm of undeletedVms) {
		// biome-ignore lint/performance/noAwaitInLoops: each VM's final usage is metered one at a time so project usage caps are applied in order
		await queueVmDeletion(db, vm);
	}
	await syncProjectUsage(organizationId);

	const now = Date.now();
	await closeProjectMeters(organizationId, now);

	if (await cancelProjectBilling(organizationId)) {
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
	const cutoff = now - DELETED_RETENTION_MS;
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
			await deleteVmRows(db, vmIds);
		}
		await db.delete(volumes).where(eq(volumes.ownerProjectId, id));
		await db.delete(projectBillingCustomers).where(eq(projectBillingCustomers.projectId, id));
		await db.delete(organization).where(eq(organization.id, id));
		purged += 1;
	}

	return { purged };
}
