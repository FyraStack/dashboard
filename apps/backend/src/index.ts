import { WorkerEntrypoint } from 'cloudflare:workers';
import { getBackend } from '#lib/server/backends/index.js';
import { inScope } from '#lib/server/context.js';
import { runBillingMeter, runIpamReconcile } from '#lib/server/jobs.js';
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

async function runJob(label: string, job: () => Promise<unknown>) {
	try {
		const result = await inScope({ headers: {}, system: true }, job);
		console.log(`${label} ok: ${JSON.stringify(result)}`);
	} catch (cause) {
		console.error(`${label} failed`, cause);
		throw cause;
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

	scheduled(_controller: ScheduledController) {
		if (this.env.BILLING_DISABLED === 'true') {
			console.warn('billing meter skipped: BILLING_DISABLED is true');
		} else {
			this.ctx.waitUntil(runJob('billing meter', runBillingMeter));
		}
		this.ctx.waitUntil(runJob('ipam reconcile', runIpamReconcile));
	}

	health() {
		return inScope({ headers: {}, system: true }, pingProxmox);
	}

	as(headers: Record<string, string>) {
		return new Caller({ headers });
	}
}

export type { Api };
