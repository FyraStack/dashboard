import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { meterActiveResources, syncPendingUsage } from '$lib/server/billing/metering';
import {
	isBillingConfigured,
	retryOrphanedProjectBillingCancellations
} from '$lib/server/billing/autumn';
import { enforceProjectBillingGrace } from '$lib/server/billing/enforcement';
import { getRuntimeEnv } from '$lib/server/env';

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().BILLING_METER_SECRET;
	if (!secret) error(503, 'Billing meter is not configured');

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) error(401, 'Unauthorized');

	if (!isBillingConfigured()) error(503, 'Billing is not configured');

	const metered = await meterActiveResources();
	const synced = await syncPendingUsage();
	const cancellations = await retryOrphanedProjectBillingCancellations();
	const enforcement = await enforceProjectBillingGrace().catch((err) => {
		console.error('Billing grace enforcement failed', err);
		return { checked: 0, suspended: 0, failed: true };
	});

	return json({ metered, synced, cancellations, enforcement });
};
