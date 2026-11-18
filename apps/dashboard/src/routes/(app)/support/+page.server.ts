import { dependencies } from '#lib/dependencies.js';
import { requireFeature } from '#lib/feature-gate.js';
import { listTickets } from '#lib/remote/support.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, parent }) => {
	depends(dependencies.support.tickets);
	await requireFeature(parent, 'support');

	return { tickets: await listTickets() };
};
