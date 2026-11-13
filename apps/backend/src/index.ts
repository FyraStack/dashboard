import { WorkerEntrypoint } from 'cloudflare:workers';
import {
	instrumentDurableObjectWithSentry,
	instrumentWorkflowWithSentry,
	withSentry
} from '@sentry/cloudflare';
import { authBasePath } from 'stack-shared/auth';
import { isSerialConsolePath } from 'stack-shared/routes';
import { initAuth } from '#lib/server/auth.js';
import { proxmox } from '#lib/server/backends/index.js';
import { runBilling, runMaintenance } from '#lib/server/jobs.js';
import { inScope, inSystemScope } from '#lib/server/scope.js';
import { rememberSentryClient, sentryOptions } from '#lib/server/sentry.js';
import { connectSerialConsole } from '#lib/server/serial-console.js';
import { SerialConsoleDurableObject } from '#lib/server/serial-console-session.js';
import { VmDeletionWorkflow } from '#lib/server/vm-deletion.js';
import { VmProvisioningWorkflow } from '#lib/server/vm-provisioning.js';
import { Caller } from './rpc/caller.ts';

export type { Account } from './rpc/account.ts';
export type { AdminAnnouncements } from './rpc/admin/announcements.ts';
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

function isAuthPath(pathname: string) {
	return pathname === authBasePath || pathname.startsWith(`${authBasePath}/`);
}

async function pingProxmox() {
	try {
		await proxmox().ping();
		return { ok: true as const };
	} catch {
		return { ok: false as const, message: 'PVE backend unavailable' };
	}
}

async function runJob(label: string, job: () => Promise<unknown>) {
	try {
		const result = await inSystemScope(job);
		console.log(`${label} ok: ${JSON.stringify(result)}`);
	} catch (cause) {
		console.error(`${label} failed`, cause);
		throw cause;
	}
}

class Api extends WorkerEntrypoint<Env> {
	fetch(request: Request) {
		const { pathname } = new URL(request.url);
		if (isSerialConsolePath(pathname)) {
			return connectSerialConsole(request);
		}
		if (!isAuthPath(pathname)) {
			return new Response('Not found', { status: 404 });
		}

		return inScope({ headers: request.headers, url: request.url, skipSession: true }, () =>
			initAuth().handler(request)
		);
	}

	scheduled(_controller: ScheduledController) {
		if (this.env.BILLING_DISABLED === 'true') {
			console.warn('billing skipped: BILLING_DISABLED is true');
		} else {
			this.ctx.waitUntil(runJob('billing', runBilling));
		}
		this.ctx.waitUntil(runJob('maintenance', runMaintenance));
	}

	health() {
		return inSystemScope(pingProxmox);
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

export class SerialConsoleSession extends instrumentDurableObjectWithSentry(
	(env: Env) => sentryOptions(env) ?? {},
	SerialConsoleDurableObject
) {}

export type { Api };
