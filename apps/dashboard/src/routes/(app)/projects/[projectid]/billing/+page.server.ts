import { redirect } from '@sveltejs/kit';
import type { ProjectBillingPage } from 'stack-backend/types';
import { billingSetupTokenParam } from 'stack-shared/billing';
import { backend } from '#lib/server/backend.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, url }) => {
	await parent();

	const page = await backend<ProjectBillingPage>((me) =>
		me.project(params.projectid).billingPage({
			billingSetupToken: url.searchParams.get(billingSetupTokenParam) ?? undefined
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
