import type { LayoutServerLoad } from './$types';
import { listVms } from '$lib/remote/vms.remote';
import { toServerInfo } from './lib/server-summary';

export const load: LayoutServerLoad = async ({ parent }) => {
	const { currentProject } = await parent();

	if (!currentProject) {
		return { projectId: null, servers: [] };
	}

	const vms = await listVms({ projectId: currentProject.id });
	const servers = vms.filter((vm) => vm.active).map(toServerInfo);

	return {
		projectId: currentProject.id,
		servers
	};
};
