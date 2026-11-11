import { error } from '#lib/server/http.js';
import {
	createAutumnClient,
	creditsFeatureId,
	defaultPlanId,
	isBillingConfigured
} from './autumn.ts';
import { ensureProjectCustomer } from './customers.ts';
import { invalidateProjectBillingStatus } from './state.ts';

export async function getProjectCreditsBalance(projectId: string) {
	const featureId = creditsFeatureId();
	if (!(featureId && isBillingConfigured())) {
		return null;
	}

	try {
		const customer = await createAutumnClient().customers.get({ customerId: projectId });
		const balance = customer.balances?.[featureId];
		if (!balance) {
			return null;
		}

		const breakdowns = balance.breakdown ?? [];
		const overage = breakdowns.find((item) => item.price?.billingMethod === 'usage_based');
		const prepaid = breakdowns.find((item) => item.price?.billingMethod === 'prepaid');
		const overagePrice = overage?.price;
		const overageRate =
			overagePrice && typeof overagePrice.amount === 'number' && overagePrice.billingUnits > 0
				? overagePrice.amount / overagePrice.billingUnits
				: null;
		const overageUsage = overage?.usage ?? 0;

		return {
			remaining: balance.remaining ?? 0,
			estimatedOverageCost:
				overageRate === null ? null : Number((overageUsage * overageRate).toFixed(2)),
			prepaidPrice: prepaid?.price
				? { amount: prepaid.price.amount ?? null, billingUnits: prepaid.price.billingUnits }
				: null
		};
	} catch (err) {
		console.error(`Failed to load credits balance for project ${projectId}`, err);
		return null;
	}
}

export async function purchaseProjectCredits(
	projectId: string,
	credits: number,
	idempotencyKey: string
) {
	const featureId = creditsFeatureId();
	const planId = defaultPlanId();
	if (!(isBillingConfigured() && featureId && planId)) {
		error(501, 'Credit purchases are not configured in this environment.');
	}

	await ensureProjectCustomer(projectId);

	const response = await createAutumnClient().billing.update(
		{
			customerId: projectId,
			planId,
			featureQuantities: [{ featureId, quantity: credits }],
			redirectMode: 'if_required'
		},
		{ headers: { 'Idempotency-Key': `credit-purchase:${projectId}:${idempotencyKey}` } }
	);

	invalidateProjectBillingStatus(projectId);
	return response.paymentUrl ?? null;
}

const ISSUED_INVOICE_STATUSES = new Set(['open', 'paid', 'uncollectible']);

function isIssuedInvoice(invoice: { status: string }) {
	return ISSUED_INVOICE_STATUSES.has(invoice.status.toLowerCase());
}

export async function getProjectInvoices(projectId: string) {
	if (!isBillingConfigured()) {
		return [];
	}

	try {
		const customer = await createAutumnClient().customers.get({
			customerId: projectId,
			expand: ['invoices']
		});

		return (customer.invoices ?? []).filter(isIssuedInvoice).map((invoice) => ({
			stripeId: invoice.stripeId,
			status: invoice.status,
			total: invoice.total,
			currency: invoice.currency,
			createdAt: invoice.createdAt,
			hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null
		}));
	} catch (err) {
		console.error(`Failed to load invoices for project ${projectId}`, err);
		return [];
	}
}
