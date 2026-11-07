import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (input: string | undefined) => input;

export const variables = defineEnvVars({
	PUBLIC_SENTRY_DSN: { public: true, schema: optional },
	STACK_TIMING_SPAM: { schema: optional },
	PUBLIC_POSTHOG_HOST: { public: true, schema: optional },
	PUBLIC_POSTHOG_KEY: { public: true, schema: optional }
});
