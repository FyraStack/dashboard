import type { KVNamespace, SendEmail } from '@cloudflare/workers-types';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';

export type RuntimeEnv = {
	ORIGIN: string;
	BETTER_AUTH_SECRET: string;
	NETBOX_API_TOKEN: string;
	NETBOX_API_URL: string;
	EMAIL?: SendEmail;
	EMAIL_FROM_ADDRESS: string;
	EMAIL_FROM_NAME: string;
	EMAIL_REPLY_TO: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_EMAIL_API_TOKEN?: string;
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
			NETBOX_API_TOKEN: required('NETBOX_API_TOKEN', platformEnv.NETBOX_API_TOKEN),
			NETBOX_API_URL: required('NETBOX_API_URL', platformEnv.NETBOX_API_URL),
			EMAIL: platformEnv.EMAIL,
			EMAIL_FROM_ADDRESS: required('EMAIL_FROM_ADDRESS', platformEnv.EMAIL_FROM_ADDRESS),
			EMAIL_FROM_NAME: required('EMAIL_FROM_NAME', platformEnv.EMAIL_FROM_NAME),
			EMAIL_REPLY_TO: required('EMAIL_REPLY_TO', platformEnv.EMAIL_REPLY_TO),
			CLOUDFLARE_ACCOUNT_ID: platformEnv.CLOUDFLARE_ACCOUNT_ID,
			CLOUDFLARE_API_TOKEN: platformEnv.CLOUDFLARE_API_TOKEN,
			CLOUDFLARE_EMAIL_API_TOKEN: platformEnv.CLOUDFLARE_EMAIL_API_TOKEN,
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
		NETBOX_API_TOKEN: required('NETBOX_API_TOKEN', privateEnv.NETBOX_API_TOKEN),
		NETBOX_API_URL: required('NETBOX_API_URL', privateEnv.NETBOX_API_URL),
		EMAIL_FROM_ADDRESS: required('EMAIL_FROM_ADDRESS', privateEnv.EMAIL_FROM_ADDRESS),
		EMAIL_FROM_NAME: required('EMAIL_FROM_NAME', privateEnv.EMAIL_FROM_NAME),
		EMAIL_REPLY_TO: required('EMAIL_REPLY_TO', privateEnv.EMAIL_REPLY_TO),
		CLOUDFLARE_ACCOUNT_ID: privateEnv.CLOUDFLARE_ACCOUNT_ID,
		CLOUDFLARE_API_TOKEN: privateEnv.CLOUDFLARE_API_TOKEN,
		CLOUDFLARE_EMAIL_API_TOKEN: privateEnv.CLOUDFLARE_EMAIL_API_TOKEN,
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
