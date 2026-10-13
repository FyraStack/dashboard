import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { PROJECT_DELETION_CLAIM_STALE_MS } from '#lib/server/auth-context.js';
import { getBackend } from '#lib/server/backends/index.js';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer,
	deleteProjectServerEntity
} from '#lib/server/billing/autumn.js';
import {
	abandonProjectUsageEvents,
	closeProjectMeters,
	meterResourceThrough,
	syncProjectUsage
} from '#lib/server/billing/metering.js';
import { invitation, organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import {
	billingMeters,
	billingUsageEvents,
	ipAssignments,
	paymentPeriods,
	projectBillingCustomers,
	vms,
	volumes
} from '#lib/server/db/schema.js';
import { releaseVmNetworking } from '#lib/server/ipam.js';

export const DELETED_PROJECT_RETENTION_DAYS = 90;

export type OrganizationDeletionResult = 'deleted' | 'already_deleted' | 'in_progress';

type Db = ReturnType<typeof initDrizzle>;

async function claimOrganizationDeletion(db: Db, organizationId: string) {
	const claimedAt = Date.now();
	const [claimed] = await db
		.update(organization)
		.set({ deletingAt: claimedAt })
		.where(
			and(
				eq(organization.id, organizationId),
				isNull(organization.deletedAt),
				or(
					isNull(organization.deletingAt),
					lt(organization.deletingAt, claimedAt - PROJECT_DELETION_CLAIM_STALE_MS)
				)
			)
		)
		.returning({ id: organization.id });

	return claimed ? claimedAt : null;
}

async function renewOrganizationDeletionClaim(db: Db, organizationId: string, claimedAt: number) {
	const renewedAt = Date.now();
	const [renewed] = await db
		.update(organization)
		.set({ deletingAt: renewedAt })
		.where(
			and(
				eq(organization.id, organizationId),
				isNull(organization.deletedAt),
				eq(organization.deletingAt, claimedAt)
			)
		)
		.returning({ id: organization.id });

	if (!renewed) {
		error(409, 'Project deletion was taken over by another request');
	}
	return renewedAt;
}

async function releaseOrganizationDeletionClaim(db: Db, organizationId: string, claimedAt: number) {
	await db
		.update(organization)
		.set({ deletingAt: null })
		.where(
			and(
				eq(organization.id, organizationId),
				isNull(organization.deletedAt),
				eq(organization.deletingAt, claimedAt)
			)
		);
}

async function closeVmMeter(vmId: string, now: number) {
	const metered = await meterResourceThrough('vm', vmId, now).catch((err) => {
		console.warn(`Failed to meter VM ${vmId} during project delete`, err);
		return null;
	});

	const db = initDrizzle();
	await db
		.update(billingMeters)
		.set({ active: false, endedAt: now })
		.where(
			and(
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.resourceId, vmId),
				eq(billingMeters.active, true)
			)
		);

	return metered;
}

async function deprovisionProjectVms(db: Db, organizationId: string, claimedAt: number) {
	const activeVms = await db.query.vms.findMany({
		where: and(eq(vms.ownerProjectId, organizationId), eq(vms.active, true)),
		columns: {
			id: true,
			name: true,
			proxmoxId: true,
			backend: true
		}
	});

	let claim = claimedAt;
	for (const vm of activeVms) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: Proxmox deletes run one at a time and the first failure must abort the project delete
			await getBackend(vm.backend).deleteVm(vm.id, vm.proxmoxId ?? undefined);
		} catch (err) {
			console.warn(`Failed to deprovision VM ${vm.id} during project delete`, err);
			await releaseOrganizationDeletionClaim(db, organizationId, claim);
			error(502, `Failed to deprovision VM "${vm.name}" in Proxmox`);
		}

		const now = Date.now();
		const metered = await closeVmMeter(vm.id, now);
		await db
			.update(vms)
			.set({ active: false, deletedAt: now })
			.where(and(eq(vms.id, vm.id), isNull(vms.deletedAt)));

		if (!metered || metered.events.length === 0 || metered.syncStatus === 'synced') {
			await deleteProjectServerEntity(organizationId, vm.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${vm.id}`, err);
			});
		}

		claim = await renewOrganizationDeletionClaim(db, organizationId, claim);
	}

	return claim;
}

export async function softDeleteOrganizationResources(
	db: Db,
	organizationId: string
): Promise<OrganizationDeletionResult> {
	const claimedAt = await claimOrganizationDeletion(db, organizationId);
	if (claimedAt === null) {
		const current = await db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { deletedAt: true }
		});
		if (!current || current.deletedAt !== null) {
			return 'already_deleted';
		}
		return 'in_progress';
	}

	const claim = await deprovisionProjectVms(db, organizationId, claimedAt);
	await syncProjectUsage(organizationId);

	const projectVms = await db
		.select({ id: vms.id })
		.from(vms)
		.where(eq(vms.ownerProjectId, organizationId));
	for (const vm of projectVms) {
		// biome-ignore lint/performance/noAwaitInLoops: releasing networking writes VyOS and Bunny config, which must not race between VMs
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
		.set({ deletedAt: now, deletingAt: null, slug: `deleted-${organizationId}` })
		.where(
			and(
				eq(organization.id, organizationId),
				isNull(organization.deletedAt),
				eq(organization.deletingAt, claim)
			)
		);

	return 'deleted';
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

		const [uncancelledBilling] = await db
			.select({ projectId: projectBillingCustomers.projectId })
			.from(projectBillingCustomers)
			.where(eq(projectBillingCustomers.projectId, id))
			.limit(1);
		if (uncancelledBilling) {
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
		await db.delete(organization).where(eq(organization.id, id));
		purged += 1;
	}

	return { purged };
}
