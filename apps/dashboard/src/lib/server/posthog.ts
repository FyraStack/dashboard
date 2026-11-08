import { waitUntil } from 'cloudflare:workers';
import type { RequestEvent } from '@sveltejs/kit';
import { PostHog } from 'posthog-node/edge';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from '$app/env/public';

function ingestHost(): string {
	return PUBLIC_POSTHOG_HOST?.includes('eu.')
		? 'https://eu.i.posthog.com'
		: 'https://us.i.posthog.com';
}

export function captureServerException(error: unknown, event: RequestEvent) {
	if (!PUBLIC_POSTHOG_KEY) {
		return;
	}

	const client = new PostHog(PUBLIC_POSTHOG_KEY, {
		host: ingestHost(),
		flushAt: 1,
		flushInterval: 0
	});
	const distinctId = event.locals.user?.id ?? 'anonymous-server';
	const pending = client
		.captureExceptionImmediate(error, distinctId, {
			$current_url: event.url.href,
			route: event.route.id,
			method: event.request.method,
			project_id: event.locals.activeProjectId ?? undefined
		})
		.then(() => client._shutdown())
		.catch((captureError) => console.warn('PostHog capture failed', captureError));

	waitUntil(pending);
}
