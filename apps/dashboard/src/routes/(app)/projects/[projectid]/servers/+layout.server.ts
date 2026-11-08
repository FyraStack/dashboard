import { error } from '@sveltejs/kit';
import { listVms } from '#lib/remote/vms.remote.js';
import type { LayoutServerLoad } from './$types';
import { toServerInfo } from './lib/server-summary';

export const load: LayoutServerLoad = async ({ params, parent, depends }) => {
	depends('project:vms');
	const { projects } = await parent();
	const project = projects.find((item) => item.id === params.projectid);

	if (!project) {
		error(404, 'Project not found');
	}

	const vms = await listVms({ projectId: project.id });
	const servers = vms
		.filter((vm) => vm.active)
		.map((vm) => ({ ...toServerInfo(vm), vmTypeId: vm.vmTypeId, vmType: vm.vmType }))
		.sort((a, b) => a.id.localeCompare(b.id));

	return {
		projectId: project.id,
		servers
	};
};
