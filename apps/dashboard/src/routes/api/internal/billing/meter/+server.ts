import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	meterActiveResources,
	reconcileOrphanedMeters,
	syncPendingUsage
} from '$lib/server/billing/metering';
import { purgeExpiredDeletedVms } from '$lib/server/vm-deletion';
import { purgeExpiredDeletedOrganizations } from '$lib/server/project-deletion';
import {
	isBillingConfigured,
	retryOrphanedProjectBillingCancellations
} from '$lib/server/billing/autumn';
import { enforceProjectBillingGrace } from '$lib/server/billing/enforcement';
import { getRuntimeEnv } from '$lib/server/env';

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().INTERNAL_CRON_SECRET;
	if (!secret) error(503, 'Internal cron is not configured');

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) error(401, 'Unauthorized');

	if (!isBillingConfigured()) error(503, 'Billing is not configured');

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

	return json({ reconciled, metered, synced, cancellations, enforcement, purge, projectPurge });
};
