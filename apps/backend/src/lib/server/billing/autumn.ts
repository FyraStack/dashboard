import { Autumn } from 'autumn-js';
import { getRuntimeEnv } from '#lib/server/env.js';

export function isBillingConfigured() {
	const env = getRuntimeEnv();
	return env.AUTUMN_ENABLED !== 'false' && Boolean(env.AUTUMN_SECRET);
}

export function createAutumnClient() {
	const secretKey = getRuntimeEnv().AUTUMN_SECRET;
	if (!secretKey) {
		throw new Error('AUTUMN_SECRET is not set');
	}

	return new Autumn({ secretKey, failOpen: false });
}

export type AutumnClient = ReturnType<typeof createAutumnClient>;

export function autumnStatus(err: unknown) {
	return typeof err === 'object' && err !== null && 'statusCode' in err
		? Number(err.statusCode)
		: null;
}

export function serverEntityFeatureId() {
	const featureId = getRuntimeEnv().AUTUMN_SERVER_ENTITY_FEATURE_ID;
	if (!featureId) {
		throw new Error('AUTUMN_SERVER_ENTITY_FEATURE_ID is not set');
	}

	return featureId;
}

export function defaultPlanId() {
	return getRuntimeEnv().AUTUMN_DEFAULT_PLAN_ID;
}

export function creditsFeatureId() {
	return getRuntimeEnv().AUTUMN_CREDITS_FEATURE_ID || undefined;
}
