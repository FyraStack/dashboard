import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { requireAdmin } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import { setFeatureFlag } from '$lib/server/feature-flags';
import type { FeatureFlagKey } from '$lib/feature-flags';

const featureFlagParam =
	"'colocation' | 'firewall' | 'images' | 'managedHosts' | 'volumes' | 'vpsConsole' | 'vpsLogs' | 'vpsNetworking' | 'vpsImages' | 'vpsSnapshots' | 'vpsBackups' | 'vpsRebuild' | 'vpsResize' | 'vpsRescue' | 'vpsSettings'";

const updateFeatureFlagParams = type({
	flag: featureFlagParam,
	enabled: 'boolean'
});

export const updateFeatureFlag = command(updateFeatureFlagParams, async (params) => {
	const event = getRequestEvent();

	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	await requireAdmin(initDrizzle(), event.locals.user.id);

	const featureFlags = await setFeatureFlag(params.flag as FeatureFlagKey, params.enabled);

	return {
		featureFlags
	};
});
