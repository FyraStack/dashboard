import type { LayoutServerLoad } from './$types';
import { listVmTypes } from '$lib/remote/vm-types.remote';
import { listImages } from '$lib/remote/images.remote';
import { listVolumes } from '$lib/remote/volumes.remote';
import { listSshKeys } from '$lib/remote/ssh-keys.remote';
import { error } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ params, parent, depends }) => {
	depends('project:create-server');
	const { featureFlags } = await parent();
	if (!params.projectid) {
		error(404, 'Project not found');
	}

	const [vmTypes, dbImages, volumes, sshKeys] = await Promise.all([
		listVmTypes(),
		listImages(),
		featureFlags?.volumes ? listVolumes({ projectId: params.projectid }) : [],
		listSshKeys()
	]);

	return {
		vmTypes,
		dbImages,
		volumes,
		sshKeys
	};
};
