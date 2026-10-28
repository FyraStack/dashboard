import { redirect } from '@sveltejs/kit';
import { listProjects } from '#lib/remote/projects.remote.js';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureFeatureFlags,
	accessibilityFixtureProjects
} from '#lib/server/accessibility-fixtures.js';
import { hasAdminRole } from '#lib/server/auth-context.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { instrument } from '#lib/server/observability.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('app:projects');
	depends('app:feature-flags');

	if (!(locals.user && locals.session)) {
		throw redirect(303, '/login');
	}

	const [projects, featureFlags] = accessibilityFixtureEnabled
		? [accessibilityFixtureProjects, accessibilityFixtureFeatureFlags]
		: await instrument('layout.app.load.dependencies', () =>
				Promise.all([listProjects(), getFeatureFlags()])
			);

	return {
		user: locals.user,
		isAdmin: hasAdminRole(locals.user.role) || locals.user.isAdmin || false,
		projects,
		activeProjectId: locals.activeProjectId ?? null,
		featureFlags
	};
};
