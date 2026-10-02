import { error } from '@sveltejs/kit';
import { getProject } from '#lib/remote/projects.remote.js';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureProjectDetails
} from '#lib/server/accessibility-fixtures.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { projects } = await parent();
	const projectSummary = projects.find((item) => item.id === params.projectid);

	if (!projectSummary) {
		error(404, 'Project not found');
	}

	const project = accessibilityFixtureEnabled
		? accessibilityFixtureProjectDetails
		: await getProject({ projectId: params.projectid });

	return { project, viewerRole: projectSummary.role };
};
