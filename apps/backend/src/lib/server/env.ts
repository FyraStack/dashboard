import { env as platformEnv } from 'cloudflare:workers';

type RequiredEnvKey =
	| 'BETTER_AUTH_SECRET'
	| 'EMAIL_FROM_ADDRESS'
	| 'EMAIL_FROM_NAME'
	| 'EMAIL_REPLY_TO'
	| 'ORIGIN';

type OptionalEnvKey =
	| 'AUTUMN_CREDITS_FEATURE_ID'
	| 'AUTUMN_DEFAULT_PLAN_ID'
	| 'AUTUMN_ENABLED'
	| 'AUTUMN_SECRET'
	| 'AUTUMN_SERVER_ENTITY_FEATURE_ID'
	| 'BUNNY_API_KEY'
	| 'CLOUDFLARE_ACCOUNT_ID'
	| 'CLOUDFLARE_API_TOKEN'
	| 'CLOUDFLARE_EMAIL_API_TOKEN'
	| 'EMAIL'
	| 'FEATURE_FLAGS'
	| 'GITHUB_CLIENT_ID'
	| 'GITHUB_CLIENT_SECRET'
	| 'HYPERDRIVE'
	| 'VYOS_API_KEY'
	| 'VYOS_API_URL'
	| 'VYOS_USE_VPC'
	| 'VYOS_VPC_01'
	| 'VYOS_VPC_02';

export type RuntimeEnv = Pick<Env, RequiredEnvKey> &
	Partial<Pick<Env, OptionalEnvKey>> & { DATABASE_URL?: string };

function required(name: RequiredEnvKey | 'AUTUMN_SECRET', value: string | undefined): string {
	if (!value) {
		throw new Error(`${name} is not set`);
	}

	return value;
}

export function getRuntimeEnv(): RuntimeEnv {
	return {
		get ORIGIN() {
			return required('ORIGIN', platformEnv.ORIGIN);
		},
		get BETTER_AUTH_SECRET() {
			return required('BETTER_AUTH_SECRET', platformEnv.BETTER_AUTH_SECRET);
		},
		VYOS_API_URL: platformEnv.VYOS_API_URL,
		VYOS_API_KEY: platformEnv.VYOS_API_KEY,
		VYOS_USE_VPC: platformEnv.VYOS_USE_VPC,
		VYOS_VPC_01: platformEnv.VYOS_VPC_01,
		VYOS_VPC_02: platformEnv.VYOS_VPC_02,
		BUNNY_API_KEY: platformEnv.BUNNY_API_KEY,
		EMAIL: platformEnv.EMAIL,
		get EMAIL_FROM_ADDRESS() {
			return required('EMAIL_FROM_ADDRESS', platformEnv.EMAIL_FROM_ADDRESS);
		},
		get EMAIL_FROM_NAME() {
			return required('EMAIL_FROM_NAME', platformEnv.EMAIL_FROM_NAME);
		},
		get EMAIL_REPLY_TO() {
			return required('EMAIL_REPLY_TO', platformEnv.EMAIL_REPLY_TO);
		},
		CLOUDFLARE_ACCOUNT_ID: platformEnv.CLOUDFLARE_ACCOUNT_ID,
		CLOUDFLARE_API_TOKEN: platformEnv.CLOUDFLARE_API_TOKEN,
		CLOUDFLARE_EMAIL_API_TOKEN: platformEnv.CLOUDFLARE_EMAIL_API_TOKEN,
		AUTUMN_ENABLED: platformEnv.AUTUMN_ENABLED,
		get AUTUMN_SECRET() {
			return import.meta.env.DEV
				? platformEnv.AUTUMN_SECRET
				: required('AUTUMN_SECRET', platformEnv.AUTUMN_SECRET);
		},
		AUTUMN_DEFAULT_PLAN_ID: platformEnv.AUTUMN_DEFAULT_PLAN_ID,
		AUTUMN_SERVER_ENTITY_FEATURE_ID: platformEnv.AUTUMN_SERVER_ENTITY_FEATURE_ID,
		AUTUMN_CREDITS_FEATURE_ID: platformEnv.AUTUMN_CREDITS_FEATURE_ID,
		HYPERDRIVE: platformEnv.HYPERDRIVE,
		FEATURE_FLAGS: platformEnv.FEATURE_FLAGS,
		GITHUB_CLIENT_ID: platformEnv.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: platformEnv.GITHUB_CLIENT_SECRET
	};
}
