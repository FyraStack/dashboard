import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!featureFlags.colocation) {
		error(404, 'Not found');
	}
};
