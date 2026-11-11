import { error } from '@sveltejs/kit';
import type { FeatureFlagKey, FeatureFlags } from 'stack-shared/feature-flags';

export async function requireFeature(
	parent: () => Promise<{ featureFlags: FeatureFlags }>,
	flag: FeatureFlagKey
) {
	const { featureFlags } = await parent();
	if (!featureFlags[flag]) {
		error(404, 'Not found');
	}
}
