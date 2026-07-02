import { error, redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, parent }) => {
	const { user, projects } = await parent();

	if (!user) {
		throw redirect(303, '/login');
	}

	const project = projects.find((p) => p.id === params.projectid);

	if (!project) {
		error(404, 'Project not found');
	}

	return {
		project
	};
};
