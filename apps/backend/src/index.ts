import { WorkerEntrypoint } from 'cloudflare:workers';
import { instrumentWorkflowWithSentry, withSentry } from '@sentry/cloudflare';
import { getBackend } from '#lib/server/backends/index.js';
import { inScope } from '#lib/server/context.js';
import { runBillingMeter, runIpamReconcile } from '#lib/server/jobs.js';
import { rememberSentryClient, sentryOptions } from '#lib/server/sentry.js';
import { VmDeletionWorkflow } from '#lib/server/vm-deletion.js';
import { VmProvisioningWorkflow } from '#lib/server/vm-provisioning.js';
import { Caller } from './rpc/caller.ts';

export type { Account } from './rpc/account.ts';
export type { AdminBilling } from './rpc/admin/billing.ts';
export type { AdminEmails } from './rpc/admin/emails.ts';
export type { AdminImages } from './rpc/admin/images.ts';
export type { AdminIpam } from './rpc/admin/ipam.ts';
export type { AdminProjects } from './rpc/admin/projects.ts';
export type { AdminUsers } from './rpc/admin/users.ts';
export type { AdminVmTypes } from './rpc/admin/vm-types.ts';
export type { AdminVms } from './rpc/admin/vms.ts';
export type { Admin } from './rpc/admin.ts';
export type { Caller } from './rpc/caller.ts';
export type { Project } from './rpc/project.ts';
export type { Projects } from './rpc/projects.ts';
export type { TwoFactorReset } from './rpc/two-factor-reset.ts';
export type { Vm } from './rpc/vm.ts';
export type { Volume } from './rpc/volume.ts';

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

class Api extends WorkerEntrypoint<Env> {
	fetch(request: Request) {
		if (!isAuthPath(new URL(request.url).pathname)) {
			return new Response('Not found', { status: 404 });
		}

		return inScope({ headers: request.headers, url: request.url, skipSession: true }, async () => {
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

	as(headers: Record<string, string>, url: string) {
		rememberSentryClient();
		return new Caller({ headers, url, retained: true });
	}
}

export default withSentry(sentryOptions, Api);

export class VmDeletion extends instrumentWorkflowWithSentry(
	(env: Env) => sentryOptions(env) ?? {},
	VmDeletionWorkflow
) {}

export class VmProvisioning extends instrumentWorkflowWithSentry(
	(env: Env) => sentryOptions(env) ?? {},
	VmProvisioningWorkflow
) {}

export type { Api };
