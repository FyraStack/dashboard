import { error } from '@sveltejs/kit';
import { and, eq, lt } from 'drizzle-orm';
import {
	isBillingConfigured,
	retryOrphanedProjectBillingCancellations
} from '#lib/server/billing/autumn.js';
import { enforceProjectBillingGrace } from '#lib/server/billing/enforcement.js';
import {
	meterActiveResources,
	reconcileOrphanedMeters,
	syncPendingUsage
} from '#lib/server/billing/metering.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { cronLeases } from '#lib/server/db/schema.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { purgeExpiredDeletedOrganizations } from '#lib/server/project-deletion.js';
import { purgeExpiredDeletedVms } from '#lib/server/vm-deletion.js';
import type { RequestHandler } from './$types';

const METER_LEASE_NAME = 'billing-meter';
const METER_LEASE_TTL_MS = 15 * 60_000;

async function acquireMeterLease(holder: string) {
	const db = initDrizzle();
	const now = Date.now();
	const claimed = await db
		.insert(cronLeases)
		.values({ name: METER_LEASE_NAME, holder, expiresAt: now + METER_LEASE_TTL_MS })
		.onConflictDoUpdate({
			target: cronLeases.name,
			set: { holder, expiresAt: now + METER_LEASE_TTL_MS },
			setWhere: lt(cronLeases.expiresAt, now)
		})
		.returning({ holder: cronLeases.holder });

	return claimed.length > 0;
}

async function releaseMeterLease(holder: string) {
	const db = initDrizzle();
	await db
		.delete(cronLeases)
		.where(and(eq(cronLeases.name, METER_LEASE_NAME), eq(cronLeases.holder, holder)));
}

async function runBillingCron() {
	const reconciled = await reconcileOrphanedMeters().catch((err) => {
		console.error('Orphaned meter reconciliation failed', err);
		return { closed: 0, failed: true };
	});
	const metered = await meterActiveResources();
	const synced = await syncPendingUsage();
	const cancellations = await retryOrphanedProjectBillingCancellations();
	const enforcement = await enforceProjectBillingGrace().catch((err) => {
		console.error('Billing grace enforcement failed', err);
		return { checked: 0, suspended: 0, failed: true };
	});
	const purge = await purgeExpiredDeletedVms().catch((err) => {
		console.error('Deleted VM purge failed', err);
		return { purged: 0, failed: true };
	});
	const projectPurge = await purgeExpiredDeletedOrganizations().catch((err) => {
		console.error('Deleted project purge failed', err);
		return { purged: 0, failed: true };
	});

	return { reconciled, metered, synced, cancellations, enforcement, purge, projectPurge };
}

export const POST: RequestHandler = async ({ request }) => {
	const secret = getRuntimeEnv().INTERNAL_CRON_SECRET;
	if (!secret) {
		error(503, 'Internal cron is not configured');
	}

	const authorization = request.headers.get('authorization');
	if (authorization !== `Bearer ${secret}`) {
		error(401, 'Unauthorized');
	}

	if (!isBillingConfigured()) {
		error(503, 'Billing is not configured');
	}

	const holder = crypto.randomUUID();
	if (!(await acquireMeterLease(holder))) {
		error(409, 'A billing run is already in progress');
	}

	try {
		return Response.json(await runBillingCron());
	} finally {
		await releaseMeterLease(holder).catch((err) => {
			console.error('Failed to release billing meter lease', err);
		});
	}
};
