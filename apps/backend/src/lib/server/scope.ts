import { APIError } from 'better-auth/api';
import { encodeHttpError } from 'stack-shared/http-error';
import { initAuth } from '#lib/server/auth.js';
import {
	type AppSession,
	type AppUser,
	type Context,
	contextFor,
	discardContext,
	runInContext,
	type Scope
} from '#lib/server/context.js';
import { closeRequestDb } from '#lib/server/db/index.js';
import { HttpError, isHttpError } from '#lib/server/http.js';
import { captureServerException } from '#lib/server/posthog.js';
import { captureSentryException } from '#lib/server/sentry.js';

interface SessionLookup {
	current: { session: AppSession; user: AppUser } | null;
	setCookie: string[];
}

const sessionsByScope = new WeakMap<Scope, Promise<SessionLookup>>();

async function lookupSession(headers: Headers): Promise<SessionLookup> {
	const { headers: responseHeaders, response } = await initAuth().api.getSession({
		headers,
		returnHeaders: true
	});
	return { current: response, setCookie: responseHeaders.getSetCookie() };
}

async function attachSession(scope: Scope, current: Context) {
	let pending = sessionsByScope.get(scope);
	if (!pending) {
		pending = lookupSession(current.request.headers);
		sessionsByScope.set(scope, pending);
		pending.catch(() => {
			if (sessionsByScope.get(scope) === pending) {
				sessionsByScope.delete(scope);
			}
		});
	}

	const resolved = await pending;
	current.setCookie = resolved.setCookie;
	if (resolved.current) {
		current.locals.session = resolved.current.session;
		current.locals.user = resolved.current.user;
		current.locals.activeProjectId = resolved.current.session.activeOrganizationId ?? null;
	}
}

function asClientError(cause: unknown): HttpError | null {
	if (isHttpError(cause)) {
		return cause;
	}

	if (cause instanceof APIError && cause.statusCode >= 400 && cause.statusCode < 500) {
		return new HttpError(cause.statusCode, cause.body?.message ?? cause.message);
	}

	return null;
}

function reportUnhandled(cause: unknown, current: Context) {
	console.error('Unhandled backend error', cause);
	captureServerException(cause, current);
	captureSentryException(cause, current);
}

function toTransportError(cause: unknown, current: Context): Error {
	const clientError = asClientError(cause);
	if (clientError) {
		return encodeHttpError(clientError);
	}

	reportUnhandled(cause, current);
	return encodeHttpError(new HttpError(500, 'Internal Error'));
}

export function releaseScope(scope: Scope) {
	const current = discardContext(scope);
	sessionsByScope.delete(scope);
	if (current) {
		closeRequestDb(current);
	}
}

export async function inScope<T>(scope: Scope, fn: () => T | Promise<T>): Promise<T> {
	const current = contextFor(scope);
	try {
		return await runInContext(current, async () => {
			if (!scope.skipSession) {
				await attachSession(scope, current);
			}
			return await fn();
		});
	} catch (cause) {
		throw toTransportError(cause, current);
	} finally {
		if (!scope.retained) {
			releaseScope(scope);
		}
	}
}

export async function inSystemScope<T>(fn: () => T | Promise<T>): Promise<T> {
	const scope: Scope = { headers: {}, skipSession: true };
	const current = contextFor(scope);
	try {
		return await runInContext(current, fn);
	} catch (cause) {
		if (!asClientError(cause)) {
			reportUnhandled(cause, current);
		}
		throw cause;
	} finally {
		releaseScope(scope);
	}
}
