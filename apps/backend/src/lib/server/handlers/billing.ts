import { billingSetupTokenParam } from 'stack-shared/billing';
import { projectBillingPath } from 'stack-shared/routes';
import { requireProjectAccess, requireUser } from '#lib/server/auth-context.js';
import { purchaseProjectCredits } from '#lib/server/billing/credits.js';
import {
	openProjectBillingPortal,
	setupProjectPayment,
	validateProjectDiscountCode
} from '#lib/server/billing/customers.js';
import { createBillingSetupToken } from '#lib/server/billing/setup-token.js';
import { context } from '#lib/server/context.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { safeReturnPath } from '#lib/server/urls.js';

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

export async function openBillingPortal(input: OpenBillingPortalInput) {
	const { db, user } = requireUser();
	const { url: requestUrl } = context();
	await requireProjectAccess(db, user.id, input.projectId, 'owner');

	const url = await openProjectBillingPortal(
		input.projectId,
		`${requestUrl.origin}${projectBillingPath(input.projectId)}`
	);
	captureServerEvent('billing_portal_opened', {}, { projectId: input.projectId });

	return { url };
}

export async function purchaseCredits(input: PurchaseCreditsInput) {
	const { db, user } = requireUser();
	if (input.credits > MAX_CREDITS_PER_PURCHASE) {
		error(
			400,
			`Credit purchases are limited to ${MAX_CREDITS_PER_PURCHASE.toLocaleString('en')} credits at a time.`
		);
	}

	await requireProjectAccess(db, user.id, input.projectId, 'owner');

	const { idempotencyKey, ...operationArgs } = input;
	const url = await withIdempotency(
		db,
		{
			key: idempotencyKey,
			operation: 'billing.purchaseCredits',
			args: { ...operationArgs, userId: user.id }
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
	const { db, user } = requireUser();
	const { url: requestUrl } = context();
	await requireProjectAccess(db, user.id, input.projectId, 'owner');

	const discountCode = input.discountCode?.trim();
	if (discountCode) {
		await validateProjectDiscountCode(input.projectId, discountCode);
	}

	const returnPath = safeReturnPath(input.returnTo, projectBillingPath(input.projectId));
	const token = await createBillingSetupToken(db, input.projectId, {
		userId: user.id,
		...(discountCode ? { promoCode: discountCode } : {})
	});
	const successUrl = new URL(returnPath, requestUrl.origin);
	successUrl.searchParams.set(billingSetupTokenParam, token);
	const url = await setupProjectPayment(input.projectId, successUrl.toString());
	captureServerEvent(
		'billing_setup_started',
		{ has_discount_code: Boolean(discountCode) },
		{ projectId: input.projectId }
	);

	return { url };
}
