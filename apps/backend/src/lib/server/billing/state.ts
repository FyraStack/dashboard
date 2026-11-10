import { eq } from 'drizzle-orm';
import { initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers } from '#lib/server/db/schema.js';
import { errorMessage } from '#lib/server/errors.js';
import { error } from '#lib/server/http.js';
import { autumnStatus, createAutumnClient, defaultPlanId, isBillingConfigured } from './autumn.ts';
import { isProjectBillingExempt } from './exemption.ts';

type BillingStatus =
	| 'active'
	| 'not_setup'
	| 'failed'
	| 'past_due'
	| 'payment_required'
	| 'provider_unavailable';

export function isBillingUsable(status: BillingStatus) {
	return status === 'active' || status === 'provider_unavailable';
}

function isActiveSubscription(subscription: {
	status?: string | null;
	pastDue?: boolean | null;
	expiresAt?: number | null;
}) {
	return (
		subscription.status === 'active' &&
		!subscription.pastDue &&
		(!subscription.expiresAt || subscription.expiresAt > Date.now())
	);
}

async function computeProjectBillingStatus(projectId: string): Promise<BillingStatus> {
	if (!isBillingConfigured()) {
		return 'active';
	}

	const db = initDrizzle();
	const localCustomer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	if (!localCustomer) {
		return 'not_setup';
	}

	if (localCustomer.syncStatus === 'failed') {
		return 'failed';
	}

	const planId = defaultPlanId();
	if (!planId) {
		return 'active';
	}

	try {
		const autumnCustomer = await createAutumnClient().customers.get({ customerId: projectId });
		const subscription = autumnCustomer.subscriptions.find((item) => item.planId === planId);

		if (subscription?.pastDue) {
			return 'past_due';
		}

		return subscription && isActiveSubscription(subscription) ? 'active' : 'payment_required';
	} catch (err) {
		const statusCode = autumnStatus(err);
		if (statusCode === 404) {
			return 'not_setup';
		}

		console.warn(`Failed to read billing status for project ${projectId}`, errorMessage(err));
		return statusCode === null || statusCode >= 500 ? 'provider_unavailable' : 'failed';
	}
}

const BILLING_STATUS_TTL_MS = 60_000;
const billingStatusCache = new Map<string, { status: BillingStatus; expiresAt: number }>();

export function invalidateProjectBillingStatus(projectId: string) {
	billingStatusCache.delete(projectId);
}

export async function getProjectBillingStatus(
	projectId: string,
	options: { live?: boolean } = {}
): Promise<BillingStatus> {
	const now = Date.now();
	if (!options.live) {
		const cached = billingStatusCache.get(projectId);
		if (cached && now < cached.expiresAt) {
			return cached.status;
		}
	}

	const status = await computeProjectBillingStatus(projectId);
	billingStatusCache.set(projectId, { status, expiresAt: now + BILLING_STATUS_TTL_MS });
	return status;
}

export async function requireProjectBillingActive(projectId: string) {
	const billingExempt = await isProjectBillingExempt(projectId);
	if (
		!(billingExempt || isBillingUsable(await getProjectBillingStatus(projectId, { live: true })))
	) {
		error(402, 'This project does not have active billing.');
	}

	return { billingExempt };
}
