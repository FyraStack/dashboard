import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const vmTypes = await listVmTypes().catch((error) => {
		console.warn(`Failed to load VM types for ${params.id}`, error);
		return [];
	});

	return { vmTypes };
};
