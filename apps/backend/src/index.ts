import { WorkerEntrypoint } from 'cloudflare:workers';
import { getBackend } from '#lib/server/backends/index.js';
import { inScope } from '#lib/server/context.js';
import { Caller } from './rpc/caller.js';

export type { Caller } from './rpc/caller.js';

const authBasePath = '/api/auth';

function isAuthPath(pathname: string) {
	return pathname === authBasePath || pathname.startsWith(`${authBasePath}/`);
}

async function pingProxmox() {
	try {
		await getBackend('proxmox').ping();
		return { ok: true as const };
	} catch {
		return { ok: false as const, message: 'PVE backend unavailable' };
	}
}

export default class Api extends WorkerEntrypoint<Env> {
	fetch(request: Request) {
		if (!isAuthPath(new URL(request.url).pathname)) {
			return new Response('Not found', { status: 404 });
		}

		return inScope({ headers: request.headers, skipSession: true }, async () => {
			const { initAuth } = await import('#lib/server/auth.js');
			return initAuth().handler(request);
		});
	}

	health() {
		return inScope({ headers: {}, system: true }, pingProxmox);
	}

	as(headers: Record<string, string>) {
		return new Caller({ headers });
	}
}

export type { Api };
