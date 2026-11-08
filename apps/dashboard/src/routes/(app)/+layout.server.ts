import { redirect } from '@sveltejs/kit';
import { listProjects } from '#lib/remote/projects.remote.js';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureFeatureFlags,
	accessibilityFixtureProjects,
	accessibilityFixtureUser
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('app:projects');
	depends('app:feature-flags');

	if (!(locals.user && locals.session)) {
		throw redirect(303, '/login');
	}

	const [projects, { featureFlags, isAdmin, unreadAnnouncements }] = accessibilityFixtureEnabled
		? [
				accessibilityFixtureProjects,
				{
					featureFlags: accessibilityFixtureFeatureFlags,
					isAdmin: accessibilityFixtureUser.isAdmin,
					unreadAnnouncements: []
				}
			]
		: await Promise.all([listProjects(), backend((me) => me.account().appLayout())]);

	return {
		user: locals.user,
		isAdmin,
		projects,
		activeProjectId: locals.activeProjectId ?? null,
		featureFlags,
		unreadAnnouncements
	};
};
