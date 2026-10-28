import { error } from '@sveltejs/kit';
import { initDrizzle } from '#lib/server/db/index.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { reconcileOrphanedIpamAllocations } from '#lib/server/ipam.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().INTERNAL_CRON_SECRET;
	if (!secret) {
		error(503, 'Internal cron is not configured');
	}

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) {
		error(401, 'Unauthorized');
	}

	const ipam = await reconcileOrphanedIpamAllocations(initDrizzle());

	return Response.json({ ipam });
};
