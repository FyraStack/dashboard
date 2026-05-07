import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireProjectAccess } from '$lib/server/auth-context';
import { getProjectBillingOverview, refreshProjectBilling } from '$lib/server/billing/overview';
import { initDrizzle } from '$lib/server/db';

export const load: PageServerLoad = async ({ locals, params, parent }) => {
	if (!locals.user) error(401, 'Authentication required');

	await parent();

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, params.projectid, 'admin');
	void refreshProjectBilling(params.projectid);

	return {
		projectId: params.projectid,
		billing: await getProjectBillingOverview(params.projectid)
	};
};
