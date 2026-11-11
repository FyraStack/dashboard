import { error } from '@sveltejs/kit';
import { dependencies } from '#lib/dependencies.js';
import { listProjects } from '#lib/remote/projects.remote.js';
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends(dependencies.app.projects, dependencies.app.featureFlags);

	const { user } = locals;
	if (!user) {
		error(401, 'Not signed in');
	}

	const [projects, { featureFlags, isAdmin, announcementsEnabled, unreadAnnouncements }] =
		await Promise.all([listProjects(), backend((me) => me.account().appLayout())]);

	return {
		user,
		isAdmin,
		projects,
		activeProjectId: locals.activeProjectId ?? null,
		featureFlags,
		announcementsEnabled,
		unreadAnnouncements
	};
};
