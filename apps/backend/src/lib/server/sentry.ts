import { waitUntil } from 'cloudflare:workers';
import { getClient, Scope } from '@sentry/cloudflare';
import type { Context } from '#lib/server/context.js';

type SentryClient = NonNullable<ReturnType<typeof getClient>>;

const flushTimeoutMs = 2000;

let isolateClient: SentryClient | undefined;

export function sentryOptions(env: Env) {
	if (!env.SENTRY_DSN) {
		return;
	}

	return {
		dsn: env.SENTRY_DSN,
		tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
		environment: import.meta.env.DEV ? 'development' : 'production',
		initialScope: { tags: { service: 'backend' } }
	};
}

export function rememberSentryClient() {
	isolateClient ??= getClient();
}

export function captureSentryException(error: unknown, event: Context) {
	const client = getClient() ?? isolateClient;
	if (!client) {
		return;
	}

	const scope = new Scope();
	scope.setTag('service', 'backend');
	scope.setTag('url', event.url.href);
	if (event.locals.user) {
		scope.setUser({ id: event.locals.user.id });
	}
	if (event.locals.activeProjectId) {
		scope.setTag('project_id', event.locals.activeProjectId);
	}

	client.captureException(error, { mechanism: { type: 'stack.rpc', handled: false } }, scope);
	waitUntil(Promise.resolve(client.flush(flushTimeoutMs)));
}
