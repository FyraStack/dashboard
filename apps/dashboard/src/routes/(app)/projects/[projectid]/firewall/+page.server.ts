import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!featureFlags.firewall) {
		error(404, 'Not found');
	}
};
