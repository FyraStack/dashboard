import { redirect } from '@sveltejs/kit';
import type { ProjectBillingPage } from 'stack-backend/types';
import {
	accessibilityFixtureBillingOverview,
	accessibilityFixtureEnabled
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, url }) => {
	await parent();

	if (accessibilityFixtureEnabled) {
		return {
			projectId: params.projectid,
			canManageBilling: true,
			billing: accessibilityFixtureBillingOverview
		};
	}

	const page = await backend<ProjectBillingPage>((me) =>
		me.project(params.projectid).billingPage({
			billingSetupToken: url.searchParams.get('billing_setup') ?? undefined
		})
	);

	if (page.kind === 'redirect') {
		redirect(303, page.location);
	}

	return {
		projectId: page.projectId,
		canManageBilling: page.canManageBilling,
		billing: page.billing
	};
};
