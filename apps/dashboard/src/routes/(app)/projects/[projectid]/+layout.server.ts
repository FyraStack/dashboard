import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, parent }) => {
	const { projects } = await parent();
	const project = projects.find((item) => item.id === params.projectid);

	if (!project) {
		error(404, 'Project not found');
	}

	return { project };
};
