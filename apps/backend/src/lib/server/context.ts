import { env } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session, User } from 'better-auth';
import type { Pool } from 'pg';
import type { Database } from '#lib/server/db/index.js';

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
	setCookie: string[];
	url: URL;
}

export interface Scope {
	headers: Headers | Record<string, string>;
	retained?: boolean;
	skipSession?: boolean;
	url?: string;
}

const quotedCookieValue = /^"(.*)"$/;
const storage = new AsyncLocalStorage<Context>();
const contextsByScope = new WeakMap<Scope, Context>();

export function currentContext(): Context | null {
	return storage.getStore() ?? null;
}

export function context(): Context {
	const current = currentContext();
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
		setCookie: [],
		url: new URL(scope.url ?? env.ORIGIN)
	};
}

export function contextFor(scope: Scope): Context {
	let current = contextsByScope.get(scope);
	if (!current) {
		current = createContext(scope);
		contextsByScope.set(scope, current);
	}
	return current;
}

export function discardContext(scope: Scope): Context | undefined {
	const current = contextsByScope.get(scope);
	contextsByScope.delete(scope);
	return current;
}

export function runInContext<T>(current: Context, fn: () => T): T {
	return storage.run(current, fn);
}
