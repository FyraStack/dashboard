import { handleErrorWithSentry } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { captureClientException } from '$lib/analytics/posthog';

if (env.PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: env.PUBLIC_SENTRY_DSN,
		tunnel: '/internal/sentry_in',
		environment: dev ? 'development' : 'production',
		sendDefaultPii: false
	});
}

const forwardToPostHog: HandleClientError = ({ error }) => {
	captureClientException(error);
};

export const handleError = handleErrorWithSentry(forwardToPostHog);
