import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getVm } from '$lib/remote/vms.remote';
import { toServerInfo } from '../lib/server-summary';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { projectId, servers } = await parent();

	if (!projectId) {
		error(404, 'Project not found');
	}

	const vm = await getVm({ vmId: params.id });

	if (!vm.active) {
		if (servers.length > 0) {
			throw redirect(303, `/servers/${servers[0].id}`);
		}

		error(404, 'Server not found');
	}

	const server = toServerInfo(vm);

	if (!servers.some((listedServer) => listedServer.id === server.id)) {
		if (servers.length > 0) {
			throw redirect(303, `/servers/${servers[0].id}`);
		}

		error(404, 'Server not found');
	}

	return {
		server
	};
};
