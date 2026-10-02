import { env as platformEnv } from 'cloudflare:workers';
import type { Fetcher, KVNamespace, SendEmail } from '@cloudflare/workers-types';
import { accessibilityFixtureEnabled } from '#lib/server/accessibility-fixtures.js';
import { dev } from '$app/env';

export interface RuntimeEnv {
	AUTUMN_CREDITS_FEATURE_ID?: string;
	AUTUMN_DEFAULT_PLAN_ID?: string;
	AUTUMN_ENABLED?: string;
	AUTUMN_SECRET?: string;
	AUTUMN_SERVER_ENTITY_FEATURE_ID?: string;
	BETTER_AUTH_SECRET: string;
	BUNNY_API_KEY?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_EMAIL_API_TOKEN?: string;
	DATABASE_URL?: string;
	EMAIL?: SendEmail;
	EMAIL_FROM_ADDRESS: string;
	EMAIL_FROM_NAME: string;
	EMAIL_REPLY_TO: string;
	FEATURE_FLAGS?: KVNamespace;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	HYPERDRIVE?: {
		connectionString: string;
	};
	INTERNAL_CRON_SECRET?: string;
	ORIGIN: string;
	VYOS_API_KEY?: string;
	VYOS_API_URL?: string;
	VYOS_USE_VPC?: string;
	VYOS_VERIFY_SSL?: string;
	VYOS_VPC_01?: Fetcher;
	VYOS_VPC_02?: Fetcher;
}

function required(name: keyof RuntimeEnv, value: string | undefined): string {
	if (!value) {
		if (accessibilityFixtureEnabled) {
			return `fixture-${name}`;
		}
		throw new Error(`${name} is not set`);
	}

	return value;
}

export function getRuntimeEnv(): RuntimeEnv {
	return {
		ORIGIN: required('ORIGIN', platformEnv.ORIGIN),
		BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET', platformEnv.BETTER_AUTH_SECRET),
		VYOS_API_URL: platformEnv.VYOS_API_URL,
		VYOS_API_KEY: platformEnv.VYOS_API_KEY,
		VYOS_VERIFY_SSL: platformEnv.VYOS_VERIFY_SSL,
		VYOS_USE_VPC: platformEnv.VYOS_USE_VPC,
		VYOS_VPC_01: platformEnv.VYOS_VPC_01,
		VYOS_VPC_02: platformEnv.VYOS_VPC_02,
		BUNNY_API_KEY: platformEnv.BUNNY_API_KEY,
		EMAIL: platformEnv.EMAIL,
		EMAIL_FROM_ADDRESS: required('EMAIL_FROM_ADDRESS', platformEnv.EMAIL_FROM_ADDRESS),
		EMAIL_FROM_NAME: required('EMAIL_FROM_NAME', platformEnv.EMAIL_FROM_NAME),
		EMAIL_REPLY_TO: required('EMAIL_REPLY_TO', platformEnv.EMAIL_REPLY_TO),
		CLOUDFLARE_ACCOUNT_ID: platformEnv.CLOUDFLARE_ACCOUNT_ID,
		CLOUDFLARE_API_TOKEN: platformEnv.CLOUDFLARE_API_TOKEN,
		CLOUDFLARE_EMAIL_API_TOKEN: platformEnv.CLOUDFLARE_EMAIL_API_TOKEN,
		AUTUMN_ENABLED: platformEnv.AUTUMN_ENABLED,
		AUTUMN_SECRET: dev
			? platformEnv.AUTUMN_SECRET
			: required('AUTUMN_SECRET', platformEnv.AUTUMN_SECRET),
		AUTUMN_DEFAULT_PLAN_ID: platformEnv.AUTUMN_DEFAULT_PLAN_ID,
		AUTUMN_SERVER_ENTITY_FEATURE_ID: platformEnv.AUTUMN_SERVER_ENTITY_FEATURE_ID,
		AUTUMN_CREDITS_FEATURE_ID: platformEnv.AUTUMN_CREDITS_FEATURE_ID,
		HYPERDRIVE: platformEnv.HYPERDRIVE,
		FEATURE_FLAGS: platformEnv.FEATURE_FLAGS,
		INTERNAL_CRON_SECRET: platformEnv.INTERNAL_CRON_SECRET,
		GITHUB_CLIENT_ID: platformEnv.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: platformEnv.GITHUB_CLIENT_SECRET
	};
}
