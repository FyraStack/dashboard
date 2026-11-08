import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command } from '$app/server';

const featureFlagParam =
	"'colocation' | 'firewall' | 'images' | 'volumes' | 'vpsConsole' | 'vpsLogs' | 'vpsNetworking' | 'vpsImages' | 'vpsSnapshots' | 'vpsBackups' | 'vpsRebuild' | 'vpsResize' | 'vpsRescue' | 'vpsSettings'";

const updateFeatureFlagParams = type({
	flag: featureFlagParam,
	enabled: 'boolean'
});

export const updateFeatureFlag = command(updateFeatureFlagParams, ({ enabled, flag }) =>
	backend((me) => me.admin().updateFeatureFlag({ enabled, flag }))
);
