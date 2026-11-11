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
import { purgeExpiredIdempotencyKeys } from '#lib/server/idempotency.js';
import { reconcileOrphanedIpamAllocations } from '#lib/server/ipam.js';
import { purgeExpiredDeletedOrganizations } from '#lib/server/project-deletion.js';
import { purgeExpiredDeletedVms } from '#lib/server/vm-deletion.js';

async function runSteps(steps: Record<string, () => Promise<unknown>>) {
	const results: Record<string, unknown> = {};
	const failed: string[] = [];

	for (const [name, step] of Object.entries(steps)) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: steps run in order so a later step sees the effects of an earlier one
			results[name] = await step();
		} catch (cause) {
			console.error(`${name} failed`, cause);
			failed.push(name);
		}
	}

	if (failed.length > 0) {
		throw new Error(`Steps failed: ${failed.join(', ')}. Completed: ${JSON.stringify(results)}`);
	}
	return results;
}

export function runBilling() {
	if (!isBillingConfigured()) {
		return Promise.resolve({ skipped: 'Billing is not configured' });
	}

	return runSteps({
		reconciled: reconcileOrphanedMeters,
		metered: meterActiveResources,
		synced: syncPendingUsage,
		cancellations: retryOrphanedProjectBillingCancellations,
		enforcement: enforceProjectBillingGrace
	});
}

export function runMaintenance() {
	return runSteps({
		idempotencyKeys: () => purgeExpiredIdempotencyKeys(),
		deletedVms: () => purgeExpiredDeletedVms(),
		deletedProjects: () => purgeExpiredDeletedOrganizations(),
		ipam: () => reconcileOrphanedIpamAllocations(initDrizzle())
	});
}
