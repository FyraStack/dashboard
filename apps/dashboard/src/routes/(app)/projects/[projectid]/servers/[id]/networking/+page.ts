import { getVmNetworking } from '#lib/remote/networking.remote.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => ({
	networking: await getVmNetworking({ vmId: params.id })
});
