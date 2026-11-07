import type { FeatureFlagKey } from '#lib/feature-flags.js';
import { requireAdmin } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { setFeatureFlag } from '#lib/server/feature-flags.js';
import { error } from '#lib/server/http.js';

export interface UpdateFeatureFlagInput {
	enabled: boolean;
	flag: FeatureFlagKey;
}

export async function updateFeatureFlag(params: UpdateFeatureFlagInput) {
	const { locals } = context();

	if (!locals.user) {
		error(401, 'Authentication required');
	}

	await requireAdmin(initDrizzle(), locals.user.id);

	const featureFlags = await setFeatureFlag(params.flag, params.enabled);

	return {
		featureFlags
	};
}
