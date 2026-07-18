import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listManagedHosts } from '$lib/remote/managed-hosts.remote';

export const load: PageServerLoad = async ({ params, parent, depends }) => {
	depends('project:managed-hosts');
	const { featureFlags } = await parent();

	if (!featureFlags.managedHosts) {
		error(404, 'Not found');
	}

	if (!params.projectid) {
		error(404, 'Project not found');
	}

	return {
		hosts: await listManagedHosts({ projectId: params.projectid })
	};
};
