import { getProjectMemberRole, requireProjectAccess } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import { attachDefaultProjectPlan, refreshProjectBilling } from '#lib/server/billing/customers.js';
import { getProjectBillingReadiness } from '#lib/server/billing/overview.js';
import { consumeBillingSetupToken } from '#lib/server/billing/setup-token.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { getIpamAvailability } from '#lib/server/ipam.js';
import { safeReturnPath } from '#lib/server/urls.js';

export interface CompleteCreateServerBillingSetupInput {
	billingSetupToken: string;
	projectId: string;
	returnPath: string;
}

export async function completeCreateServerBillingSetup(
	input: CompleteCreateServerBillingSetupInput
) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, input.projectId, 'owner');

	const grant = await consumeBillingSetupToken(
		db,
		input.projectId,
		event.locals.user.id,
		input.billingSetupToken
	);
	if (!grant) {
		return { paymentUrl: null };
	}

	const returnPath = safeReturnPath(
		input.returnPath,
		`/projects/${input.projectId}/servers/create`
	);
	const paymentUrl = await attachDefaultProjectPlan(
		input.projectId,
		`${event.url.origin}${returnPath}`,
		grant.promoCode
	);
	if (paymentUrl) {
		return { paymentUrl };
	}

	await refreshProjectBilling(input.projectId);
	return { paymentUrl: null };
}

export interface LoadCreateServerPageInput {
	projectId: string;
}

export async function loadCreateServerPage(input: LoadCreateServerPageInput) {
	const event = context();
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, input.projectId);

	runInBackground(refreshProjectBilling(input.projectId), 'refreshProjectBilling');
	const [billing, ipamAvailability, role] = await Promise.all([
		getProjectBillingReadiness(input.projectId),
		getIpamAvailability(db),
		getProjectMemberRole(db, event.locals.user.id, input.projectId)
	]);

	return {
		billing,
		ipamAvailability,
		canManageBilling: role === 'owner'
	};
}
