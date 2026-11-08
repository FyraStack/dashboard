import { getProjectMemberRole, requireProjectAccess } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import { attachDefaultProjectPlan } from '#lib/server/billing/autumn.js';
import { getProjectBillingReadiness, refreshProjectBilling } from '#lib/server/billing/overview.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { safeReturnPath } from '#lib/server/handlers/billing.js';
import { error } from '#lib/server/http.js';
import { getIpamAvailability } from '#lib/server/ipam.js';

export interface CompleteCreateServerBillingSetupInput {
	projectId: string;
	promoCode?: string;
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

	const returnPath = safeReturnPath(
		input.returnPath,
		`/projects/${input.projectId}/servers/create`
	);
	const paymentUrl = await attachDefaultProjectPlan(
		input.projectId,
		`${event.url.origin}${returnPath}`,
		input.promoCode
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
