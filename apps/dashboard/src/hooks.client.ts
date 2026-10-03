import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit/hooks';
import { captureClientException } from '#lib/analytics/posthog.js';
import { dev } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

if (PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: PUBLIC_SENTRY_DSN,
		tracesSampleRate: dev ? 1.0 : 0.1,
		tunnel: '/internal/sentry_in',
		environment: dev ? 'development' : 'production'
	});
}

const forwardToPostHog: HandleClientError = ({ kind, error }) => {
	if (kind !== 'unknown') {
		return;
	}
	captureClientException(error);
};

export const handleError = handleErrorWithSentry(forwardToPostHog);
