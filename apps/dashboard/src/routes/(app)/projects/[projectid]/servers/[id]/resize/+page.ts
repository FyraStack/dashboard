import type { PageLoad } from './$types';
import { getVm } from '$lib/remote/vms.remote';
import { listVmTypes } from '$lib/remote/vm-types.remote';

export const load: PageLoad = async ({ params }) => {
	const [vmTypes, vm] = await Promise.all([
		listVmTypes().catch(() => []),
		getVm({ vmId: params.id }).catch(() => null)
	]);

	return {
		vmTypes,
		currentVmTypeId: vm?.vmTypeId ?? null,
		currentVmType: vm?.vmType ?? null
	};
};
