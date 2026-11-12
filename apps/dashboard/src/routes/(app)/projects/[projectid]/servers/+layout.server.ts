import { dependencies } from '#lib/dependencies.js';
import { listVms } from '#lib/remote/vms.remote.js';
import { toServerInfo } from '#lib/server-info.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent, depends }) => {
	depends(dependencies.project.vms);
	const { project } = await parent();

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
