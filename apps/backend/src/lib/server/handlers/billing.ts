import { requireProjectAccess } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import {
	openProjectBillingPortal,
	purchaseProjectCredits,
	setupProjectPayment,
	validateProjectDiscountCode
} from '#lib/server/billing/autumn.js';
import { getProjectBillingOverview, refreshProjectBilling } from '#lib/server/billing/overview.js';
import {
	BILLING_SETUP_QUERY_PARAM,
	createBillingSetupToken
} from '#lib/server/billing/setup-token.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { safeReturnPath } from '#lib/server/urls.js';

export interface GetProjectBillingInput {
	projectId: string;
}
export interface OpenBillingPortalInput {
	projectId: string;
}
export interface PurchaseCreditsInput {
	credits: number;
	idempotencyKey: string;
	projectId: string;
}
export interface SetupProjectBillingPaymentInput {
	discountCode?: string;
	projectId: string;
	returnTo?: string;
}

const MAX_CREDITS_PER_PURCHASE = 1_000_000;

export async function getProjectBilling(input: GetProjectBillingInput) {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');
	runInBackground(refreshProjectBilling(input.projectId), 'refreshProjectBilling');

	return getProjectBillingOverview(input.projectId);
}

export async function openBillingPortal(input: OpenBillingPortalInput) {
	const { locals, url: requestUrl } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'owner');

	const url = await openProjectBillingPortal(
		input.projectId,
		`${requestUrl.origin}/projects/${input.projectId}/billing`
	);
	captureServerEvent('billing_portal_opened', {}, { projectId: input.projectId });

	return { url };
}

export async function purchaseCredits(input: PurchaseCreditsInput) {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}
	if (input.credits > MAX_CREDITS_PER_PURCHASE) {
		error(
			400,
			`Credit purchases are limited to ${MAX_CREDITS_PER_PURCHASE.toLocaleString('en')} credits at a time.`
		);
	}

	const userId = locals.user.id;
	const db = initDrizzle();
	await requireProjectAccess(db, userId, input.projectId, 'owner');

	const { idempotencyKey, ...operationArgs } = input;
	const url = await withIdempotency(
		db,
		{
			key: idempotencyKey,
			operation: 'billing.purchaseCredits',
			args: { ...operationArgs, userId }
		},
		async () => {
			const paymentUrl = await purchaseProjectCredits(
				input.projectId,
				input.credits,
				idempotencyKey
			);
			captureServerEvent(
				'credit_purchase_started',
				{ credits: input.credits },
				{ projectId: input.projectId }
			);
			return paymentUrl;
		}
	);

	return { url };
}

export async function setupProjectBillingPayment(input: SetupProjectBillingPaymentInput) {
	const { locals, url: requestUrl } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'owner');

	const discountCode = input.discountCode?.trim();
	if (discountCode) {
		await validateProjectDiscountCode(input.projectId, discountCode);
	}

	const returnPath = safeReturnPath(input.returnTo, `/projects/${input.projectId}/billing`);
	const token = await createBillingSetupToken(db, input.projectId, {
		userId: locals.user.id,
		...(discountCode ? { promoCode: discountCode } : {})
	});
	const successUrl = new URL(returnPath, requestUrl.origin);
	successUrl.searchParams.set(BILLING_SETUP_QUERY_PARAM, token);
	const url = await setupProjectPayment(input.projectId, successUrl.toString());
	captureServerEvent(
		'billing_setup_started',
		{ has_discount_code: Boolean(discountCode) },
		{ projectId: input.projectId }
	);

	return { url };
}
