import { type } from 'arktype';
import { featureFlagKey } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command } from '$app/server';

const updateFeatureFlagParams = type({
	flag: featureFlagKey,
	enabled: 'boolean'
});

export const updateFeatureFlag = command(updateFeatureFlagParams, ({ enabled, flag }) =>
	backend((me) => me.admin().updateFeatureFlag({ enabled, flag }))
);
