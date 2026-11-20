import { requireFeature } from '#lib/feature-gate.js';
import { listVms } from '#lib/remote/vms.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	await requireFeature(parent, 'support');

	const { projects } = await parent();
	const project = projects.find(({ id }) => id === url.searchParams.get('project'));
	const vms = project ? await listVms({ projectId: project.id }) : [];
	const servers = vms.filter((vm) => vm.active).map(({ id, name }) => ({ id, name }));

	return {
		servers,
		preselectedServerId: servers.find(({ id }) => id === url.searchParams.get('vm'))?.id ?? null
	};
};
