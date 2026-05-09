import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { listProjects } from '$lib/remote/projects.remote';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { getFeatureFlags } from '$lib/server/feature-flags';
import { hasAdminRole } from '$lib/server/auth-context';

export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	depends('app:projects');
	depends('app:feature-flags');
	const pathname = url.pathname;

	if (!locals.user || !locals.session) {
		throw redirect(303, '/login');
	}

	const event = getRequestEvent();
	if (!event?.locals.user) throw redirect(303, '/login');

	const db = initDrizzle();
	const [projects, featureFlags, currentUser] = await Promise.all([
		listProjects(),
		getFeatureFlags(),
		db.query.user.findFirst({ where: eq(user.id, event.locals.user.id) })
	]);
	const requestedProjectId = url.searchParams.get('projectId');
	const pathMatch = pathname.match(/^\/projects\/([^/]+)/);
	const activeProjectId = requestedProjectId ?? pathMatch?.[1] ?? locals.activeProjectId;
	const isOnRootPage = pathname === '/';
	const currentProject = isOnRootPage
		? null
		: (projects.find((project) => project.id === activeProjectId) ??
			(requestedProjectId ? null : (projects[0] ?? null)));

	return {
		user: locals.user,
		isAdmin: hasAdminRole(currentUser?.role) || currentUser?.isAdmin || false,
		projects,
		currentProject,
		featureFlags
	};
};
