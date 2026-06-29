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
const FLAGS_CACHE_TTL_MS = 30_000;

let flagsCache: { flags: FeatureFlags; expiresAt: number } | null = null;

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

	const now = Date.now();
	if (flagsCache && now < flagsCache.expiresAt) {
		return flagsCache.flags;
	}

	const storedFlags = await kv.get(FEATURE_FLAGS_KEY, 'json');
	const flags = normalizeFeatureFlags(
		storedFlags as Partial<Record<FeatureFlagKey, unknown>> | null
	);
	flagsCache = { flags, expiresAt: now + FLAGS_CACHE_TTL_MS };
	return flags;
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

	const storedFlags = await kv.get(FEATURE_FLAGS_KEY, 'json');
	const currentFlags = normalizeFeatureFlags(
		storedFlags as Partial<Record<FeatureFlagKey, unknown>> | null
	);
	const nextFlags = {
		...currentFlags,
		[flag]: enabled
	};

	await kv.put(FEATURE_FLAGS_KEY, JSON.stringify(nextFlags));
	flagsCache = { flags: nextFlags, expiresAt: Date.now() + FLAGS_CACHE_TTL_MS };

	return nextFlags;
}

export async function requireFeatureFlag(flag: FeatureFlagKey): Promise<void> {
	const flags = await getFeatureFlags();

	if (!flags[flag]) {
		error(404, 'Not found');
	}
}
