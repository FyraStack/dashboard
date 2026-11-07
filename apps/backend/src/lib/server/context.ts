import { env } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session, User } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { Pool } from 'pg';
import { closeRequestDb, type Database } from '#lib/server/db/index.js';
import { encodeHttpError, HttpError, isHttpError } from '#lib/server/http.js';
import { captureServerException } from '#lib/server/posthog.js';

export type AppSession = Session & {
	activeOrganizationId?: string | null;
};

export type AppUser = User & { role?: string | null; isAdmin?: boolean };

export interface Locals {
	accessCache?: Map<string, Promise<unknown>>;
	activeProjectId?: string | null;
	backgroundTasks?: Promise<unknown>[];
	db?: Database;
	dbPool?: Pool;
	session?: AppSession;
	user?: AppUser;
}

export interface Context {
	cookies: { get: (name: string) => string | undefined };
	locals: Locals;
	request: { headers: Headers };
	url: URL;
}

export interface Scope {
	headers: Headers | Record<string, string>;
	skipSession?: boolean;
	system?: boolean;
}

interface ScopeSession {
	session: AppSession;
	user: AppUser;
}

const quotedCookieValue = /^"(.*)"$/;
const storage = new AsyncLocalStorage<Context>();
const sessionsByScope = new WeakMap<Scope, Promise<ScopeSession | null>>();

export function context(): Context {
	const current = storage.getStore();
	if (!current) {
		throw new Error('context() was called outside of inScope()');
	}
	return current;
}

function parseCookies(header: string | null): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const pair of header?.split(';') ?? []) {
		const separator = pair.indexOf('=');
		if (separator === -1) {
			continue;
		}
		const name = pair.slice(0, separator).trim();
		if (!name || cookies.has(name)) {
			continue;
		}
		const raw = pair
			.slice(separator + 1)
			.trim()
			.replace(quotedCookieValue, '$1');
		try {
			cookies.set(name, decodeURIComponent(raw));
		} catch {
			cookies.set(name, raw);
		}
	}
	return cookies;
}

function createContext(scope: Scope): Context {
	const headers = new Headers(scope.headers);
	const cookies = parseCookies(headers.get('cookie'));
	return {
		cookies: { get: (name) => cookies.get(name) },
		locals: {},
		request: { headers },
		url: new URL(env.ORIGIN)
	};
}

async function lookupSession(headers: Headers): Promise<ScopeSession | null> {
	const { initAuth } = await import('#lib/server/auth.js');
	return initAuth().api.getSession({ headers });
}

async function attachSession(scope: Scope, current: Context) {
	let pending = sessionsByScope.get(scope);
	if (!pending) {
		pending = lookupSession(current.request.headers);
		sessionsByScope.set(scope, pending);
	}

	const resolved = await pending;
	if (resolved) {
		current.locals.session = resolved.session;
		current.locals.user = resolved.user;
		current.locals.activeProjectId = resolved.session.activeOrganizationId ?? null;
	}
}

function toTransportError(cause: unknown, current: Context): Error {
	if (isHttpError(cause)) {
		return encodeHttpError(cause);
	}

	if (cause instanceof APIError && cause.statusCode < 500) {
		return encodeHttpError(new HttpError(cause.statusCode, cause.body?.message ?? cause.message));
	}

	console.error('Unhandled backend error', cause);
	captureServerException(cause, current);
	return encodeHttpError(new HttpError(500, 'Internal Error'));
}

export async function inScope<T>(scope: Scope, fn: () => T | Promise<T>): Promise<T> {
	const current = createContext(scope);
	try {
		return await storage.run(current, async () => {
			if (!(scope.system || scope.skipSession)) {
				await attachSession(scope, current);
			}
			return await fn();
		});
	} catch (cause) {
		throw toTransportError(cause, current);
	} finally {
		closeRequestDb(current);
	}
}
