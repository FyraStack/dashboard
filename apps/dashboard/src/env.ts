import { defineEnvVars } from '@sveltejs/kit/env';

// Server config and bindings come from `cloudflare:workers` (see #lib/server/env.ts); only these are read via $app/env.
const optional = (input: string | undefined) => input;

export const variables = defineEnvVars({
	PUBLIC_SENTRY_DSN: { public: true, schema: optional },
	STACK_TIMING_SPAM: { schema: optional },
	PUBLIC_POSTHOG_HOST: { public: true, schema: optional },
	PUBLIC_POSTHOG_KEY: { public: true, schema: optional }
});
