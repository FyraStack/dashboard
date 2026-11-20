import { dependencies } from '#lib/dependencies.js';
import { requireFeature } from '#lib/feature-gate.js';
import { listAdminTickets } from '#lib/remote/admin-support.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, parent }) => {
	depends(dependencies.admin.tickets);
	await requireFeature(parent, 'support');

	return { tickets: await listAdminTickets() };
};
