import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { getBackend } from '#lib/server/backends/index.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers, vms } from '#lib/server/db/schema.js';
import {
	sendProjectPastDueEmail,
	sendProjectSuspendedEmail
} from '#lib/server/email-notifications.js';
import { getProjectBillingState, isBillingConfigured } from './autumn';

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

const NOTIFY_CLAIM_TTL_MS = 10 * 60_000;

type BillingNotice = 'pastDue' | 'suspended';

const NOTICES = {
	pastDue: {
		label: 'past-due',
		triggeredAt: projectBillingCustomers.pastDueSince,
		notifiedAt: projectBillingCustomers.pastDueNotifiedAt,
		markNotified: (at: number) => ({ pastDueNotifiedAt: at }),
		send: (projectId: string) => sendProjectPastDueEmail(projectId, GRACE_PERIOD_DAYS)
	},
	suspended: {
		label: 'suspension',
		triggeredAt: projectBillingCustomers.suspendedAt,
		notifiedAt: projectBillingCustomers.suspendedNotifiedAt,
		markNotified: (at: number) => ({ suspendedNotifiedAt: at }),
		send: (projectId: string) => sendProjectSuspendedEmail(projectId)
	}
} as const;

async function claimNotice(db: Database, projectId: string, notice: BillingNotice, now: number) {
	const { triggeredAt, notifiedAt } = NOTICES[notice];
	const claimed = await db
		.update(projectBillingCustomers)
		.set({ notifyClaimedAt: now })
		.where(
			and(
				eq(projectBillingCustomers.projectId, projectId),
				isNotNull(triggeredAt),
				isNull(notifiedAt),
				or(
					isNull(projectBillingCustomers.notifyClaimedAt),
					lt(projectBillingCustomers.notifyClaimedAt, now - NOTIFY_CLAIM_TTL_MS)
				)
			)
		)
		.returning({ projectId: projectBillingCustomers.projectId });

	return claimed.length > 0;
}

async function sendNotice(db: Database, projectId: string, notice: BillingNotice, now: number) {
	if (!(await claimNotice(db, projectId, notice, now))) {
		return;
	}

	const { label, send, markNotified } = NOTICES[notice];
	try {
		const email = await send(projectId);
		if (email) {
			console.info(`Sent ${label} email to ${email} for project ${projectId}`);
		}
		await db
			.update(projectBillingCustomers)
			.set({ ...markNotified(Date.now()), notifyClaimedAt: null })
			.where(eq(projectBillingCustomers.projectId, projectId));
	} catch (err) {
		console.warn(`Failed to send ${label} email for project ${projectId}`, err);
		await db
			.update(projectBillingCustomers)
			.set({ notifyClaimedAt: null })
			.where(
				and(
					eq(projectBillingCustomers.projectId, projectId),
					eq(projectBillingCustomers.notifyClaimedAt, now)
				)
			);
	}
}

async function markProjectPastDue(db: Database, projectId: string, now: number) {
	await db
		.update(projectBillingCustomers)
		.set({ pastDueSince: now, updatedAt: now })
		.where(
			and(
				eq(projectBillingCustomers.projectId, projectId),
				isNull(projectBillingCustomers.pastDueSince)
			)
		);
}

async function suspendProject(db: Database, projectId: string, now: number) {
	const stopped = await suspendProjectVms(projectId);
	await db
		.update(projectBillingCustomers)
		.set({ suspendedAt: now, updatedAt: now })
		.where(
			and(
				eq(projectBillingCustomers.projectId, projectId),
				isNull(projectBillingCustomers.suspendedAt)
			)
		);
	return stopped;
}

async function sendPendingNotices(db: Database, projectId: string, now: number) {
	const customer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId),
		columns: { suspendedAt: true }
	});

	await sendNotice(
		db,
		projectId,
		(customer?.suspendedAt ?? null) === null ? 'pastDue' : 'suspended',
		now
	);
}

async function enforceProjectGrace(db: Database, projectId: string, now: number) {
	const state = await getProjectBillingState(projectId, { live: true });
	const customer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	if (PAST_DUE_STATUSES.has(state.status)) {
		const pastDueSince = customer?.pastDueSince ?? null;
		let stopped = 0;
		if (pastDueSince === null) {
			await markProjectPastDue(db, projectId, now);
		} else if (now - pastDueSince >= GRACE_PERIOD_MS) {
			stopped = await suspendProject(db, projectId, now);
		}

		await sendPendingNotices(db, projectId, now);
		return stopped;
	}

	if (
		state.status === 'active' &&
		customer &&
		(customer.pastDueSince !== null || customer.suspendedAt !== null)
	) {
		await db
			.update(projectBillingCustomers)
			.set({
				pastDueSince: null,
				suspendedAt: null,
				pastDueNotifiedAt: null,
				suspendedNotifiedAt: null,
				notifyClaimedAt: null,
				updatedAt: now
			})
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
