import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { requireProjectAccess } from '$lib/server/auth-context';
import {
	openProjectBillingPortal,
	setupProjectPayment,
	validateProjectDiscountCode
} from '$lib/server/billing/autumn';
import { getProjectBillingOverview, refreshProjectBilling } from '$lib/server/billing/overview';
import { runInBackground } from '$lib/server/background';
import { initDrizzle } from '$lib/server/db';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureBillingOverview
} from '$lib/server/accessibility-fixtures';

const projectParams = type({ projectId: 'string' });
const setupParams = type({ projectId: 'string', returnTo: 'string?', discountCode: 'string?' });

function safeReturnPath(value: string | undefined, fallback: string) {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;

	return value;
}

export const getProjectBilling = query(projectParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	if (accessibilityFixtureEnabled) return accessibilityFixtureBillingOverview;

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');
	runInBackground(refreshProjectBilling(params.projectId), 'refreshProjectBilling');

	return getProjectBillingOverview(params.projectId);
});

export const openBillingPortal = command(projectParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'owner');

	const url = await openProjectBillingPortal(
		params.projectId,
		`${event.url.origin}/projects/${params.projectId}/billing`
	);

	return { url };
});

export const setupProjectBillingPayment = command(setupParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'owner');

	const discountCode = params.discountCode?.trim();
	if (discountCode) await validateProjectDiscountCode(params.projectId, discountCode);

	const returnPath = safeReturnPath(params.returnTo, `/projects/${params.projectId}/billing`);
	const separator = returnPath.includes('?') ? '&' : '?';
	const promoParam = discountCode ? `&billing_promo=${encodeURIComponent(discountCode)}` : '';
	const successUrl = `${event.url.origin}${returnPath}${separator}billing_setup=complete${promoParam}`;
	const url = await setupProjectPayment(params.projectId, successUrl);

	return { url };
});
