import { browser, dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import posthog from 'posthog-js';

export const posthogProxyPath = '/internal/phog_in';

let initialized = false;

export function initPostHog() {
	if (!browser || initialized) return;

	const token = env.PUBLIC_POSTHOG_KEY;
	if (!token) return;

	initialized = true;
	posthog.init(token, {
		api_host: posthogProxyPath,
		ui_host: env.PUBLIC_POSTHOG_HOST || 'https://us.posthog.com',
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
	if (!initialized) return;
	posthog.captureException(error);
}
