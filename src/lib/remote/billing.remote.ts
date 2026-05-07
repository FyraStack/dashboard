import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { requireProjectAccess } from '$lib/server/auth-context';
import { openProjectBillingPortal } from '$lib/server/billing/autumn';
import { getProjectBillingOverview, refreshProjectBilling } from '$lib/server/billing/overview';
import { initDrizzle } from '$lib/server/db';

const projectParams = type({ projectId: 'string' });

export const getProjectBilling = query(projectParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');
	void refreshProjectBilling(params.projectId);

	return getProjectBillingOverview(params.projectId);
});

export const openBillingPortal = command(projectParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	const url = await openProjectBillingPortal(
		params.projectId,
		`${event.url.origin}/projects/${params.projectId}/billing`
	);

	return { url };
});
