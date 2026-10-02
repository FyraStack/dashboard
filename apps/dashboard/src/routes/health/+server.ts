// simple healthcheck endpoint
// simply pings the PVE backend and attempts to list nodes
//
// the latency to this endpoint measures the time it takes for a round-trip to the PVE backend over VPC

import { error } from '@sveltejs/kit';
import { getBackend } from '#lib/server/backends/index.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		await getBackend('proxmox').ping();
	} catch {
		error(503, 'PVE backend unavailable');
	}

	return new Response('OK', { status: 200 });
};
