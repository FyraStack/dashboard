import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getManagedHost } from '$lib/remote/managed-hosts.remote';

export const load: PageServerLoad = async ({ params, parent, depends }) => {
	depends(`managed-host:${params.id}`);
	const { featureFlags } = await parent();

	if (!featureFlags.managedHosts) {
		error(404, 'Not found');
	}

	if (!params.projectid) {
		error(404, 'Project not found');
	}

	const host = await getManagedHost({ hostId: params.id });
	if (host.ownerProjectId !== params.projectid) error(404, 'Managed host not found');

	return { host };
};
