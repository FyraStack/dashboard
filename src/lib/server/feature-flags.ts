import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import {
	defaultFeatureFlags,
	developmentFeatureFlags,
	featureFlagKeys,
	type FeatureFlagKey,
	type FeatureFlags
} from '$lib/feature-flags';
import { getRuntimeEnv } from '$lib/server/env';

const FEATURE_FLAGS_KEY = 'feature-flags';

function normalizeFeatureFlags(
	value: Partial<Record<FeatureFlagKey, unknown>> | null | undefined
): FeatureFlags {
	return Object.fromEntries(
		featureFlagKeys.map((key) => [
			key,
			typeof value?.[key] === 'boolean' ? value[key] : defaultFeatureFlags[key]
		])
	) as FeatureFlags;
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
	const runtimeEnv = getRuntimeEnv();
	const kv = runtimeEnv.FEATURE_FLAGS;

	if (!kv) {
		if (dev) {
			return developmentFeatureFlags;
		}

		return defaultFeatureFlags;
	}

	const storedFlags = await kv.get(FEATURE_FLAGS_KEY, 'json');
	return normalizeFeatureFlags(storedFlags as Partial<Record<FeatureFlagKey, unknown>> | null);
}

export async function setFeatureFlag(
	flag: FeatureFlagKey,
	enabled: boolean
): Promise<FeatureFlags> {
	const runtimeEnv = getRuntimeEnv();
	const kv = runtimeEnv.FEATURE_FLAGS;

	if (!kv) {
		if (dev) {
			return {
				...developmentFeatureFlags,
				[flag]: enabled
			};
		}

		throw new Error('Feature flag KV binding is unavailable');
	}

	const currentFlags = await getFeatureFlags();
	const nextFlags = {
		...currentFlags,
		[flag]: enabled
	};

	await kv.put(FEATURE_FLAGS_KEY, JSON.stringify(nextFlags));

	return nextFlags;
}

export async function requireFeatureFlag(flag: FeatureFlagKey): Promise<void> {
	const flags = await getFeatureFlags();

	if (!flags[flag]) {
		error(404, 'Not found');
	}
}
