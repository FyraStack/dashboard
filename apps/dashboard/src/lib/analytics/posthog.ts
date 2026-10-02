import posthog from 'posthog-js';
import { browser, dev } from '$app/env';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from '$app/env/public';

export const posthogProxyPath = '/internal/phog_in';

let initialized = false;

export function initPostHog() {
	if (!browser || initialized) {
		return;
	}

	const token = PUBLIC_POSTHOG_KEY;
	if (!token) {
		return;
	}

	initialized = true;
	posthog.init(token, {
		api_host: posthogProxyPath,
		ui_host: PUBLIC_POSTHOG_HOST || 'https://us.posthog.com',
		capture_pageview: 'history_change',
		capture_pageleave: 'if_capture_pageview',
		capture_exceptions: {
			capture_unhandled_errors: true,
			capture_unhandled_rejections: true,
			capture_console_errors: true
		},
		person_profiles: 'identified_only',
		logs: {
			captureConsoleLogs: true,
			serviceName: 'stack-dashboard',
			environment: dev ? 'development' : 'production'
		}
	});
}

export function captureClientException(error: unknown) {
	if (!initialized) {
		return;
	}
	posthog.captureException(error);
}
