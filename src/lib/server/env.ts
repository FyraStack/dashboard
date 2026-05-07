import type { KVNamespace } from '@cloudflare/workers-types';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';

export type RuntimeEnv = {
	ORIGIN: string;
	BETTER_AUTH_SECRET: string;
	AUTUMN_SECRET: string;
	AUTUMN_DEFAULT_PLAN_ID?: string;
	AUTUMN_SERVER_ENTITY_FEATURE_ID?: string;
	DATABASE_URL?: string;
	HYPERDRIVE?: {
		connectionString: string;
	};
	FEATURE_FLAGS?: KVNamespace;
	PROXMOX_CACHE?: KVNamespace;
	BILLING_METER_SECRET?: string;
	// OAuth (optional — social providers are conditionally enabled)
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
};

function required(name: keyof RuntimeEnv, value: string | undefined): string {
	if (!value) throw new Error(`${name} is not set`);

	return value;
}

export function getRuntimeEnv(): RuntimeEnv {
	const platformEnv = getRequestEvent().platform?.env;

	if (platformEnv) {
		return {
			ORIGIN: required('ORIGIN', platformEnv.ORIGIN),
			BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET', platformEnv.BETTER_AUTH_SECRET),
			AUTUMN_SECRET: required('AUTUMN_SECRET', platformEnv.AUTUMN_SECRET),
			AUTUMN_DEFAULT_PLAN_ID: platformEnv.AUTUMN_DEFAULT_PLAN_ID,
			AUTUMN_SERVER_ENTITY_FEATURE_ID: platformEnv.AUTUMN_SERVER_ENTITY_FEATURE_ID,
			HYPERDRIVE: platformEnv.HYPERDRIVE,
			FEATURE_FLAGS: platformEnv.FEATURE_FLAGS,
			PROXMOX_CACHE: platformEnv.PROXMOX_CACHE,
			BILLING_METER_SECRET: platformEnv.BILLING_METER_SECRET,
			GITHUB_CLIENT_ID: platformEnv.GITHUB_CLIENT_ID,
			GITHUB_CLIENT_SECRET: platformEnv.GITHUB_CLIENT_SECRET,
			GOOGLE_CLIENT_ID: platformEnv.GOOGLE_CLIENT_ID,
			GOOGLE_CLIENT_SECRET: platformEnv.GOOGLE_CLIENT_SECRET
		};
	}

	if (!dev) {
		throw new Error('Cloudflare bindings are unavailable on this request');
	}

	return {
		ORIGIN: required('ORIGIN', privateEnv.ORIGIN),
		BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET', privateEnv.BETTER_AUTH_SECRET),
		AUTUMN_SECRET: required('AUTUMN_SECRET', privateEnv.AUTUMN_SECRET),
		AUTUMN_DEFAULT_PLAN_ID: privateEnv.AUTUMN_DEFAULT_PLAN_ID,
		AUTUMN_SERVER_ENTITY_FEATURE_ID: privateEnv.AUTUMN_SERVER_ENTITY_FEATURE_ID,
		DATABASE_URL: required('DATABASE_URL', privateEnv.DATABASE_URL),
		BILLING_METER_SECRET: privateEnv.BILLING_METER_SECRET,
		GITHUB_CLIENT_ID: privateEnv.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: privateEnv.GITHUB_CLIENT_SECRET,
		GOOGLE_CLIENT_ID: privateEnv.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: privateEnv.GOOGLE_CLIENT_SECRET
	};
}
