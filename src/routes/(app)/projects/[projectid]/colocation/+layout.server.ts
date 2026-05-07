import { requireFeatureFlag } from '$lib/server/feature-flags';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	await requireFeatureFlag('colocation');
};
