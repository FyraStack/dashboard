import { env } from 'cloudflare:workers';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function backendHealthy() {
	try {
		const result = await env.BACKEND.health();
		return result.ok;
	} catch {
		return false;
	}
}

export const GET: RequestHandler = async () => {
	if (!(await backendHealthy())) {
		error(503, 'PVE backend unavailable');
	}

	return new Response('OK', { status: 200 });
};
