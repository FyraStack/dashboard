import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
	defaultFeatureFlags,
	developmentFeatureFlags,
	featureFlagKeys,
	type FeatureFlagKey,
	type FeatureFlags
} from '$lib/feature-flags';
import { getRuntimeEnv } from '$lib/server/env';
import { instrument, timingLog } from '$lib/server/observability';

const FEATURE_FLAGS_KEY = 'feature-flags';
const FLAGS_FRESH_TTL_MS = 60_000;
const FLAGS_STALE_TTL_MS = 15 * 60_000;

type FlagsCache = {
	flags: FeatureFlags;
	freshUntil: number;
	staleUntil: number;
};

let flagsCache: FlagsCache | null = null;
let flagsRefresh: Promise<FeatureFlags> | null = null;

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

function cacheFlags(flags: FeatureFlags): FeatureFlags {
	const now = Date.now();
	flagsCache = {
		flags,
		freshUntil: now + FLAGS_FRESH_TTL_MS,
		staleUntil: now + FLAGS_STALE_TTL_MS
	};
	return flags;
}

async function loadFeatureFlagsFromKv(kv: KVNamespace): Promise<FeatureFlags> {
	return instrument('featureFlags.kv.get', async () => {
		const storedFlags = await kv.get(FEATURE_FLAGS_KEY, 'json');
		return cacheFlags(
			normalizeFeatureFlags(storedFlags as Partial<Record<FeatureFlagKey, unknown>> | null)
		);
	});
}

function scheduleFeatureFlagRefresh(kv: KVNamespace): Promise<FeatureFlags> {
	if (!flagsRefresh) {
		flagsRefresh = loadFeatureFlagsFromKv(kv)
			.catch((err) => {
				console.warn('Failed to refresh feature flags from KV', err);
				return flagsCache?.flags ?? defaultFeatureFlags;
			})
			.finally(() => {
				flagsRefresh = null;
			});
	}

	try {
		getRequestEvent().platform?.ctx?.waitUntil(flagsRefresh.then(() => undefined));
	} catch {
		// getFeatureFlags can be imported in non-request contexts during local tooling.
	}

	return flagsRefresh;
}

export async function getFeatureFlags(options?: { fresh?: boolean }): Promise<FeatureFlags> {
	const runtimeEnv = getRuntimeEnv();
	const kv = runtimeEnv.FEATURE_FLAGS;

	if (!kv) {
		if (dev) {
			return developmentFeatureFlags;
		}

		return defaultFeatureFlags;
	}

	const now = Date.now();
	if (flagsCache && now < flagsCache.freshUntil) {
		return flagsCache.flags;
	}

	if (options?.fresh) {
		timingLog('featureFlags.freshRead');
		return loadFeatureFlagsFromKv(kv);
	}

	if (flagsCache && now < flagsCache.staleUntil) {
		void scheduleFeatureFlagRefresh(kv);
		timingLog('featureFlags.cache.stale');
		return flagsCache.flags;
	}

	timingLog(flagsCache ? 'featureFlags.cache.expiredRead' : 'featureFlags.cache.coldRead');
	return scheduleFeatureFlagRefresh(kv);
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

	const currentFlags = await getFeatureFlags({ fresh: true });
	const nextFlags = {
		...currentFlags,
		[flag]: enabled
	};

	await kv.put(FEATURE_FLAGS_KEY, JSON.stringify(nextFlags));
	cacheFlags(nextFlags);

	return nextFlags;
}

export async function requireFeatureFlag(flag: FeatureFlagKey): Promise<void> {
	const flags = await getFeatureFlags({ fresh: true });

	if (!flags[flag]) {
		error(404, 'Not found');
	}
}
