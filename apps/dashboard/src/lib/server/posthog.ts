import type { RequestEvent } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/public';
import { PostHog } from 'posthog-node/edge';

type EventProperties = Record<string, string | number | boolean | null | undefined>;

type CaptureOptions = {
	distinctId?: string;
	projectId?: string | null;
	set?: EventProperties;
};

function ingestHost(): string {
	return env.PUBLIC_POSTHOG_HOST?.includes('eu.')
		? 'https://eu.i.posthog.com'
		: 'https://us.i.posthog.com';
}

function createClient(): PostHog | null {
	const token = env.PUBLIC_POSTHOG_KEY;
	if (!token) return null;
	return new PostHog(token, { host: ingestHost(), flushAt: 1, flushInterval: 0 });
}

function currentEvent(): RequestEvent | null {
	try {
		return getRequestEvent();
	} catch {
		return null;
	}
}

function dispatch(event: RequestEvent | null, send: (client: PostHog) => Promise<void>) {
	const client = createClient();
	if (!client) return;

	const pending = send(client)
		.then(() => client._shutdown())
		.catch((captureError) => console.warn('PostHog capture failed', captureError));

	const ctx = event?.platform?.ctx;
	if (ctx) ctx.waitUntil(pending);
}

function requestContext(event: RequestEvent | null): EventProperties {
	if (!event) return {};
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
	if (!distinctId) return;

	const projectId = options.projectId ?? event?.locals.activeProjectId ?? undefined;

	dispatch(event, async (client) => {
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
	dispatch(event, (client) =>
		client.captureExceptionImmediate(error, distinctId, {
			...requestContext(event),
			project_id: event.locals.activeProjectId ?? undefined
		})
	);
}
