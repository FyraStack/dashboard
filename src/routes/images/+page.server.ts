import type { PageServerLoad } from './$types';
import { listImages, listProxmoxIsos } from '$lib/remote/images.remote';

export const load: PageServerLoad = async () => {
	const [images, proxmoxIsos] = await Promise.all([listImages(), listProxmoxIsos()]);

	return {
		images,
		proxmoxIsos
	};
};
