import { error } from '@sveltejs/kit';
import { listProjectImages } from '#lib/remote/custom-images.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, depends }) => {
	depends('project:images');
	const { featureFlags } = await parent();

	if (!featureFlags.images) {
		error(404, 'Not found');
	}

	return await listProjectImages({ projectId: params.projectid });
};
