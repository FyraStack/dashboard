import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { getBackend } from '#lib/server/backends/index.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers, vms } from '#lib/server/db/schema.js';
import {
	sendProjectPastDueEmail,
	sendProjectSuspendedEmail
} from '#lib/server/email-notifications.js';
import { isBillingConfigured } from './autumn.ts';
import { getProjectBillingStatus } from './state.ts';

const GRACE_PERIOD_DAYS = 1000;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
const PAST_DUE_STATUSES = new Set(['past_due', 'payment_required']);

async function suspendProjectVms(projectId: string) {
	const db = initDrizzle();
	const activeVms = await db.query.vms.findMany({
		where: and(eq(vms.ownerProjectId, projectId), eq(vms.active, true)),
		columns: { id: true, proxmoxId: true, backend: true }
	});

	let stopped = 0;
	for (const vm of activeVms) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: VMs are stopped one at a time so Proxmox isn't flooded with concurrent stop tasks
			await getBackend(vm.backend).stopVm(vm.id, vm.proxmoxId ?? undefined);
			stopped += 1;
		} catch (err) {
			console.warn(`Failed to suspend VM ${vm.id} for past-due project ${projectId}`, err);
		}
	}

	return stopped;
}

interface EscalationClaim {
	set: Partial<typeof projectBillingCustomers.$inferInsert>;
	unclaimed: SQL;
}

async function claimAndNotify(
	db: Database,
	projectId: string,
	now: number,
	claim: EscalationClaim,
	notice: { label: string; send: () => Promise<string | null> }
) {
	const claimed = await db
		.update(projectBillingCustomers)
		.set({ ...claim.set, updatedAt: now })
		.where(and(eq(projectBillingCustomers.projectId, projectId), claim.unclaimed))
		.returning({ projectId: projectBillingCustomers.projectId });
	if (claimed.length === 0) {
		return;
	}

	await notice
		.send()
		.then((email) => {
			if (email) {
				console.info(`Sent ${notice.label} email to ${email} for project ${projectId}`);
			}
		})
		.catch((err) => {
			console.warn(`Failed to send ${notice.label} email for project ${projectId}`, err);
		});
}

function markProjectPastDue(db: Database, projectId: string, now: number) {
	return claimAndNotify(
		db,
		projectId,
		now,
		{ set: { pastDueSince: now }, unclaimed: isNull(projectBillingCustomers.pastDueSince) },
		{ label: 'past-due', send: () => sendProjectPastDueEmail(projectId, GRACE_PERIOD_DAYS) }
	);
}

async function suspendProject(db: Database, projectId: string, now: number) {
	const stopped = await suspendProjectVms(projectId);
	await claimAndNotify(
		db,
		projectId,
		now,
		{ set: { suspendedAt: now }, unclaimed: isNull(projectBillingCustomers.suspendedAt) },
		{ label: 'suspension', send: () => sendProjectSuspendedEmail(projectId) }
	);
	return stopped;
}

async function enforceProjectGrace(db: Database, projectId: string, now: number) {
	const status = await getProjectBillingStatus(projectId, { live: true });
	const customer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	if (PAST_DUE_STATUSES.has(status)) {
		const pastDueSince = customer?.pastDueSince ?? null;
		if (pastDueSince === null) {
			await markProjectPastDue(db, projectId, now);
			return 0;
		}

		if (now - pastDueSince >= GRACE_PERIOD_MS) {
			return await suspendProject(db, projectId, now);
		}
		return 0;
	}

	if (
		status === 'active' &&
		customer &&
		(customer.pastDueSince !== null || customer.suspendedAt !== null)
	) {
		await db
			.update(projectBillingCustomers)
			.set({ pastDueSince: null, suspendedAt: null, updatedAt: now })
			.where(eq(projectBillingCustomers.projectId, projectId));
	}
	return 0;
}

export async function enforceProjectBillingGrace(now = Date.now()) {
	if (!isBillingConfigured()) {
		return { checked: 0, suspended: 0 };
	}

	const db = initDrizzle();
	const projects = await db
		.selectDistinct({ projectId: vms.ownerProjectId })
		.from(vms)
		.where(eq(vms.active, true))
		.orderBy(asc(vms.ownerProjectId));

	let suspended = 0;
	for (const { projectId } of projects) {
		if (!projectId) {
			continue;
		}

		// biome-ignore lint/performance/noAwaitInLoops: projects are checked one at a time to pace Autumn API calls, Proxmox stops and emails
		suspended += await enforceProjectGrace(db, projectId, now);
	}

	return { checked: projects.length, suspended };
}
