import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listImages } from '$lib/remote/images.remote';

export const load: PageServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!featureFlags.images) {
		error(404, 'Not found');
	}

	const images = await listImages();

	return {
		images
	};
};
