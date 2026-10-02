import type { HandleClientError } from '@sveltejs/kit/hooks';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';
import { captureClientException } from '#lib/analytics/posthog.js';

if (PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: PUBLIC_SENTRY_DSN,
		tunnel: '/internal/sentry_in',
		environment: dev ? 'development' : 'production'
	});
}

const forwardToPostHog: HandleClientError = ({ kind, error }) => {
	if (kind !== 'unknown') return;
	captureClientException(error);
};

export const handleError = handleErrorWithSentry(forwardToPostHog);
