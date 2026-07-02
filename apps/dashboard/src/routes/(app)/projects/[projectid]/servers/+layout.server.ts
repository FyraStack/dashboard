import { error } from '@sveltejs/kit';
import { listVms } from '$lib/remote/vms.remote';
import type { LayoutServerLoad } from './$types';
import { toServerInfo } from './lib/server-summary';
import { instrument } from '$lib/server/observability';

export const load: LayoutServerLoad = async ({ params, parent, depends }) => {
	depends('project:vms');
	const { projects } = await instrument('layout.servers.parent', () => parent(), {
		'project.id': params.projectid
	});
	const project = projects.find((item) => item.id === params.projectid);

	if (!project) {
		error(404, 'Project not found');
	}

	const vms = await instrument('layout.servers.listVms', () => listVms({ projectId: project.id }), {
		'project.id': project.id
	});
	const servers = vms
		.filter((vm) => vm.active)
		.map(toServerInfo)
		.sort((a, b) => a.id.localeCompare(b.id));

	return {
		projectId: project.id,
		servers
	};
};
