import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { listProjects } from '$lib/remote/projects.remote';
import { getFeatureFlags } from '$lib/server/feature-flags';
import { hasAdminRole } from '$lib/server/auth-context';

export const load: LayoutServerLoad = async ({ locals, url, depends }) => {
	depends('app:projects');
	depends('app:feature-flags');
	const pathname = url.pathname;

	if (!locals.user || !locals.session) {
		throw redirect(303, '/login');
	}

	const [projects, featureFlags] = await Promise.all([listProjects(), getFeatureFlags()]);
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
		isAdmin: hasAdminRole(locals.user.role) || locals.user.isAdmin || false,
		projects,
		currentProject,
		featureFlags
	};
};
