import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ parent }) => {
	const { featureFlags } = await parent();

	if (!featureFlags.firewall) {
		error(404, 'Not found');
	}
};
