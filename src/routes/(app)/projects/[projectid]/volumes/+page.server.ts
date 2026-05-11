import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listVolumes } from '$lib/remote/volumes.remote';
import { listVms } from '$lib/remote/vms.remote';

export const load: PageServerLoad = async ({ params, parent, depends }) => {
	depends('project:volumes');
	depends('project:vms');
	const { featureFlags } = await parent();

	if (!featureFlags.volumes) {
		error(404, 'Not found');
	}

	if (!params.projectid) {
		error(404, 'Project not found');
	}

	const [volumes, vms] = await Promise.all([
		listVolumes({ projectId: params.projectid }),
		listVms({ projectId: params.projectid })
	]);

	return {
		volumes,
		vms
	};
};
