import {
	isBillingConfigured,
	retryOrphanedProjectBillingCancellations
} from '#lib/server/billing/autumn.js';
import { enforceProjectBillingGrace } from '#lib/server/billing/enforcement.js';
import {
	meterActiveResources,
	reconcileOrphanedMeters,
	syncPendingUsage
} from '#lib/server/billing/metering.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { purgeExpiredIdempotencyKeys } from '#lib/server/idempotency.js';
import { reconcileOrphanedIpamAllocations } from '#lib/server/ipam.js';
import { purgeExpiredDeletedOrganizations } from '#lib/server/project-deletion.js';
import { purgeExpiredDeletedVms } from '#lib/server/vm-deletion.js';

export async function runBillingMeter() {
	const idempotencyPurge = await purgeExpiredIdempotencyKeys().catch((err) => {
		console.error('Idempotency key purge failed', err);
		return { purged: 0, failed: true };
	});

	if (!isBillingConfigured()) {
		error(503, 'Billing is not configured');
	}

	const reconciled = await reconcileOrphanedMeters().catch((err) => {
		console.error('Orphaned meter reconciliation failed', err);
		return { closed: 0, failed: true };
	});
	const metered = await meterActiveResources();
	const synced = await syncPendingUsage();
	const cancellations = await retryOrphanedProjectBillingCancellations();
	const enforcement = await enforceProjectBillingGrace().catch((err) => {
		console.error('Billing grace enforcement failed', err);
		return { checked: 0, suspended: 0, failed: true };
	});
	const purge = await purgeExpiredDeletedVms().catch((err) => {
		console.error('Deleted VM purge failed', err);
		return { purged: 0, failed: true };
	});
	const projectPurge = await purgeExpiredDeletedOrganizations().catch((err) => {
		console.error('Deleted project purge failed', err);
		return { purged: 0, failed: true };
	});
	return {
		reconciled,
		metered,
		synced,
		cancellations,
		enforcement,
		purge,
		projectPurge,
		idempotencyPurge
	};
}

export async function runIpamReconcile() {
	const ipam = await reconcileOrphanedIpamAllocations(initDrizzle());
	return { ipam };
}
