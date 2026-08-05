import type { PageLoad } from './$types';
import { getVmNetworking } from '$lib/remote/networking.remote';

export const load: PageLoad = async ({ params }) => {
	const networking = await getVmNetworking({ vmId: params.id }).catch((error) => {
		console.warn(`Failed to load networking for ${params.id}`, error);
		return { allocations: [] };
	});

	return { networking };
};
