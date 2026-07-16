import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRuntimeEnv } from '$lib/server/env';
import { initDrizzle } from '$lib/server/db';
import { reconcileOrphanedIpamAllocations } from '$lib/server/ipam';

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().INTERNAL_CRON_SECRET;
	if (!secret) error(503, 'Internal cron is not configured');

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) error(401, 'Unauthorized');

	const ipam = await reconcileOrphanedIpamAllocations(initDrizzle());

	return json({ ipam });
};
