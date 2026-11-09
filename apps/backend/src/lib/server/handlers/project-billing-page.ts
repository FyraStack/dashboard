import { getProjectMemberRole, requireProjectAccess } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import { attachDefaultProjectPlan } from '#lib/server/billing/autumn.js';
import { getProjectBillingOverview, refreshProjectBilling } from '#lib/server/billing/overview.js';
import { consumeBillingSetupToken } from '#lib/server/billing/setup-token.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';

export interface LoadProjectBillingPageInput {
	billingSetupToken?: string;
	projectId: string;
}

export type ProjectBillingPage =
	| { kind: 'redirect'; location: string }
	| {
			kind: 'page';
			projectId: string;
			canManageBilling: boolean;
			billing: Awaited<ReturnType<typeof getProjectBillingOverview>>;
	  };

export async function loadProjectBillingPage(
	input: LoadProjectBillingPageInput
): Promise<ProjectBillingPage> {
	const { locals, url } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');
	const role = await getProjectMemberRole(db, locals.user.id, input.projectId);

	if (input.billingSetupToken) {
		const billingPath = `/projects/${input.projectId}/billing`;
		if (role !== 'owner') {
			error(403, 'Project owner permission required');
		}

		const grant = await consumeBillingSetupToken(
			db,
			input.projectId,
			locals.user.id,
			input.billingSetupToken
		);
		if (!grant) {
			return { kind: 'redirect', location: billingPath };
		}

		const paymentUrl = await attachDefaultProjectPlan(
			input.projectId,
			`${url.origin}${billingPath}`,
			grant.promoCode
		);
		if (paymentUrl) {
			return { kind: 'redirect', location: paymentUrl };
		}

		await refreshProjectBilling(input.projectId);
		return { kind: 'redirect', location: billingPath };
	}

	runInBackground(refreshProjectBilling(input.projectId), 'refreshProjectBilling');

	return {
		kind: 'page',
		projectId: input.projectId,
		canManageBilling: role === 'owner',
		billing: await getProjectBillingOverview(input.projectId)
	};
}
