import { projectBillingPath } from 'stack-shared/routes';
import {
	getProjectMemberRole,
	requireProjectAccess,
	requireUser
} from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import { attachDefaultProjectPlan, refreshProjectBilling } from '#lib/server/billing/customers.js';
import { getProjectBillingOverview } from '#lib/server/billing/overview.js';
import { consumeBillingSetupToken } from '#lib/server/billing/setup-token.js';
import { context } from '#lib/server/context.js';
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
	const { db, user } = requireUser();
	const { url } = context();
	await requireProjectAccess(db, user.id, input.projectId, 'admin');
	const role = await getProjectMemberRole(db, user.id, input.projectId);

	if (input.billingSetupToken) {
		const billingPath = projectBillingPath(input.projectId);
		if (role !== 'owner') {
			error(403, 'Project owner permission required');
		}

		const grant = await consumeBillingSetupToken(
			db,
			input.projectId,
			user.id,
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
