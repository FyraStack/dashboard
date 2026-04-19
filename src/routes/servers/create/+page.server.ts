import type { PageServerLoad } from './$types';
import { listVmTypes } from '$lib/remote/vm-types.remote';
import { listImages } from '$lib/remote/images.remote';
import { listVolumes } from '$lib/remote/volumes.remote';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentProject } = await parent();
	if (!currentProject) {
		error(404, 'Project not found');
	}

	const [vmTypes, dbImages, volumes] = await Promise.all([
		listVmTypes(),
		listImages(),
		listVolumes({ projectId: currentProject.id })
	]);

	return {
		vmTypes,
		dbImages,
		volumes
	};
};
