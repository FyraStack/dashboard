import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { meterActiveResources, syncPendingUsage } from '$lib/server/billing/metering';
import { getRuntimeEnv } from '$lib/server/env';

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().BILLING_METER_SECRET;
	if (!secret) error(503, 'Billing meter is not configured');

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) error(401, 'Unauthorized');

	const metered = await meterActiveResources();
	const synced = await syncPendingUsage();

	return json({ metered, synced });
};
