import { waitUntil } from 'cloudflare:workers';
import type { RequestEvent } from '@sveltejs/kit';
import { PostHog } from 'posthog-node/edge';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from '$app/env/public';
import { getRequestEvent } from '$app/server';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

interface CaptureOptions {
	distinctId?: string;
	projectId?: string | null;
	set?: EventProperties;
}

function ingestHost(): string {
	return PUBLIC_POSTHOG_HOST?.includes('eu.')
		? 'https://eu.i.posthog.com'
		: 'https://us.i.posthog.com';
}

function createClient(): PostHog | null {
	const token = PUBLIC_POSTHOG_KEY;
	if (!token) {
		return null;
	}
	return new PostHog(token, { host: ingestHost(), flushAt: 1, flushInterval: 0 });
}

function currentEvent(): RequestEvent | null {
	try {
		return getRequestEvent();
	} catch {
		return null;
	}
}

function dispatch(send: (client: PostHog) => Promise<void>) {
	const client = createClient();
	if (!client) {
		return;
	}

	const pending = send(client)
		.then(() => client._shutdown())
		.catch((captureError) => console.warn('PostHog capture failed', captureError));

	waitUntil(pending);
}

function requestContext(event: RequestEvent | null): EventProperties {
	if (!event) {
		return {};
	}
	return {
		$current_url: event.url.href,
		route: event.route.id,
		method: event.request.method
	};
}

export function captureServerEvent(
	name: string,
	properties: EventProperties = {},
	options: CaptureOptions = {}
) {
	const event = currentEvent();
	const distinctId = options.distinctId ?? event?.locals.user?.id;
	if (!distinctId) {
		return;
	}

	const projectId = options.projectId ?? event?.locals.activeProjectId ?? undefined;

	dispatch(async (client) => {
		client.capture({
			distinctId,
			event: name,
			properties: {
				...requestContext(event),
				...properties,
				...(projectId ? { project_id: projectId } : {}),
				...(options.set ? { $set: options.set } : {})
			},
			groups: projectId ? { project: projectId } : undefined
		});
		await client.flush();
	});
}

export function captureServerException(error: unknown, event: RequestEvent) {
	const distinctId = event.locals.user?.id ?? 'anonymous-server';
	dispatch((client) =>
		client.captureExceptionImmediate(error, distinctId, {
			...requestContext(event),
			project_id: event.locals.activeProjectId ?? undefined
		})
	);
}
