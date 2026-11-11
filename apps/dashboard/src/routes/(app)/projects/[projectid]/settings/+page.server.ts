import { getProject } from '#lib/remote/projects.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { project: projectSummary } = await parent();

	return {
		project: await getProject({ projectId: params.projectid }),
		viewerRole: projectSummary.role
	};
};
