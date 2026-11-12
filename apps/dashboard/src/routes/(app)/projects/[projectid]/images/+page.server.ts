import { requireFeature } from '#lib/feature-gate.js';
import { listImages } from '#lib/remote/images.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	await requireFeature(parent, 'images');

	return { images: await listImages() };
};
