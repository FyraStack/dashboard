import { waitUntil } from 'cloudflare:workers';
import type { KVNamespace } from '@cloudflare/workers-types';
import { error } from '@sveltejs/kit';
import {
	defaultFeatureFlags,
	developmentFeatureFlags,
	type FeatureFlagKey,
	type FeatureFlags,
	featureFlagKeys
} from '#lib/feature-flags.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { instrument, timingLog } from '#lib/server/observability.js';
import { dev } from '$app/env';

const FEATURE_FLAGS_KEY = 'feature-flags';
const FEATURE_FLAG_KEY_PREFIX = 'feature-flag:';
const FLAGS_FRESH_TTL_MS = 60_000;
const FLAGS_STALE_TTL_MS = 15 * 60_000;

interface FlagsCache {
	flags: FeatureFlags;
	freshUntil: number;
	staleUntil: number;
}

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

function featureFlagKey(flag: FeatureFlagKey) {
	return `${FEATURE_FLAG_KEY_PREFIX}${flag}`;
}

async function loadFeatureFlagsFromKv(kv: KVNamespace): Promise<FeatureFlags> {
	return await instrument('featureFlags.kv.get', async () => {
		const [legacyFlags, flagValues] = await Promise.all([
			kv.get(FEATURE_FLAGS_KEY, 'json') as Promise<Partial<Record<FeatureFlagKey, unknown>> | null>,
			Promise.all(featureFlagKeys.map((flag) => kv.get(featureFlagKey(flag))))
		]);
		const storedFlags: Partial<Record<FeatureFlagKey, unknown>> = { ...legacyFlags };
		featureFlagKeys.forEach((flag, index) => {
			const value = flagValues[index];
			if (value === 'true' || value === 'false') {
				storedFlags[flag] = value === 'true';
			}
		});
		return cacheFlags(normalizeFeatureFlags(storedFlags));
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

	waitUntil(flagsRefresh.then(() => undefined));

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
		return await loadFeatureFlagsFromKv(kv);
	}

	if (flagsCache && now < flagsCache.staleUntil) {
		scheduleFeatureFlagRefresh(kv);
		timingLog('featureFlags.cache.stale');
		return flagsCache.flags;
	}

	timingLog(flagsCache ? 'featureFlags.cache.expiredRead' : 'featureFlags.cache.coldRead');
	return await scheduleFeatureFlagRefresh(kv);
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

	await kv.put(featureFlagKey(flag), String(enabled));
	const currentFlags = await loadFeatureFlagsFromKv(kv);
	return cacheFlags({
		...currentFlags,
		[flag]: enabled
	});
}

export async function requireFeatureFlag(flag: FeatureFlagKey): Promise<void> {
	const flags = await getFeatureFlags({ fresh: true });

	if (!flags[flag]) {
		error(404, 'Not found');
	}
}
