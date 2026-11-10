import type { FeatureFlagKey } from 'stack-shared/feature-flags';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { setFeatureFlag } from '#lib/server/feature-flags.js';

export interface UpdateFeatureFlagInput {
	enabled: boolean;
	flag: FeatureFlagKey;
}

export async function updateFeatureFlag(params: UpdateFeatureFlagInput) {
	await requireAdminUser();

	const featureFlags = await setFeatureFlag(params.flag, params.enabled);

	return {
		featureFlags
	};
}
