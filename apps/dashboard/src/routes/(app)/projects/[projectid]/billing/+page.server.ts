import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProjectMemberRole, requireProjectAccess } from '$lib/server/auth-context';
import { attachDefaultProjectPlan } from '$lib/server/billing/autumn';
import { getProjectBillingOverview, refreshProjectBilling } from '$lib/server/billing/overview';
import { runInBackground } from '$lib/server/background';
import { initDrizzle } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, params, parent, url }) => {
	if (!locals.user) error(401, 'Authentication required');

	await parent();

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, params.projectid, 'admin');
	const role = await getProjectMemberRole(db, locals.user.id, params.projectid);

	if (url.searchParams.get('billing_setup') === 'complete') {
		if (role !== 'owner') error(403, 'Project owner permission required');

		const paymentUrl = await attachDefaultProjectPlan(
			params.projectid,
			`${url.origin}/projects/${params.projectid}/billing`
		);
		if (paymentUrl) redirect(303, paymentUrl);

		await refreshProjectBilling(params.projectid);
		redirect(303, `/projects/${params.projectid}/billing`);
	}

	runInBackground(refreshProjectBilling(params.projectid), 'refreshProjectBilling');

	return {
		projectId: params.projectid,
		canManageBilling: role === 'owner',
		billing: await getProjectBillingOverview(params.projectid)
	};
};
