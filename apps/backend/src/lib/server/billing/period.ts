import { autumnStatus, createAutumnClient, defaultPlanId, isBillingConfigured } from './autumn.ts';
import type { CapPeriod } from './caps.ts';

export type ProjectBillingPeriodLookup =
	| { customer: 'found'; anchor: CapPeriod | null }
	| { customer: 'missing' };

async function findAutumnCustomer(projectId: string) {
	try {
		return await createAutumnClient().customers.get({ customerId: projectId });
	} catch (err) {
		if (autumnStatus(err) === 404) {
			return null;
		}
		throw err;
	}
}

export async function lookupProjectBillingPeriod(
	projectId: string
): Promise<ProjectBillingPeriodLookup> {
	if (!isBillingConfigured()) {
		return { customer: 'found', anchor: null };
	}

	const customer = await findAutumnCustomer(projectId);
	if (!customer) {
		return { customer: 'missing' };
	}

	const planId = defaultPlanId();
	const subscription = planId
		? customer.subscriptions.find((item) => item.planId === planId)
		: undefined;
	if (!(subscription?.currentPeriodStart && subscription.currentPeriodEnd)) {
		return { customer: 'found', anchor: null };
	}

	return {
		customer: 'found',
		anchor: { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd }
	};
}
