import { WorkerEntrypoint } from 'cloudflare:workers';
import { instrumentWorkflowWithSentry, withSentry } from '@sentry/cloudflare';
import { getBackend } from '#lib/server/backends/index.js';
import { inScope } from '#lib/server/context.js';
import { runBillingMeter, runIpamReconcile } from '#lib/server/jobs.js';
import { rememberSentryClient, sentryOptions } from '#lib/server/sentry.js';
import { VmDeletionWorkflow } from '#lib/server/vm-deletion.js';
import { VmProvisioningWorkflow } from '#lib/server/vm-provisioning.js';
import { Caller } from './rpc/caller.js';

export type { Account } from './rpc/account.js';
export type { AdminBilling } from './rpc/admin/billing.js';
export type { AdminEmails } from './rpc/admin/emails.js';
export type { AdminImages } from './rpc/admin/images.js';
export type { AdminIpam } from './rpc/admin/ipam.js';
export type { AdminProjects } from './rpc/admin/projects.js';
export type { AdminUsers } from './rpc/admin/users.js';
export type { AdminVmTypes } from './rpc/admin/vm-types.js';
export type { AdminVms } from './rpc/admin/vms.js';
export type { Admin } from './rpc/admin.js';
export type { Caller } from './rpc/caller.js';
export type { Project } from './rpc/project.js';
export type { Projects } from './rpc/projects.js';
export type { TwoFactorReset } from './rpc/two-factor-reset.js';
export type { Vm } from './rpc/vm.js';
export type { Volume } from './rpc/volume.js';

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
