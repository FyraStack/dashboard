import { env } from 'cloudflare:workers';
import { type Cookies, error } from '@sveltejs/kit';
import type { Api } from 'stack-backend';
import { getRequestEvent } from '$app/server';

export type Me = ReturnType<Service<Api>['as']>;

type CookieOptions = NonNullable<Parameters<Cookies['set']>[2]>;

interface SetCookie {
	name: string;
	options: CookieOptions;
	value: string;
}

const httpErrorMarker = 'stack-http-error:';

const forwardedHeaderNames = [
	'cookie',
	'user-agent',
	'cf-connecting-ip',
	'x-forwarded-for',
	'x-real-ip',
	'accept-language',
	'origin',
	'sentry-trace',
	'baggage'
];

export function forwardedHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const name of forwardedHeaderNames) {
		const value = request.headers.get(name);
		if (value !== null) {
			headers[name] = value;
		}
	}
	return headers;
}

function decodeHttpError(cause: unknown): { status: number; message: string } | null {
	if (!(cause instanceof Error)) {
		return null;
	}

	const start = cause.message.indexOf(httpErrorMarker);
	if (start === -1) {
		return null;
	}

	try {
		const decoded: unknown = JSON.parse(cause.message.slice(start + httpErrorMarker.length));
		if (
			typeof decoded === 'object' &&
			decoded !== null &&
			'status' in decoded &&
			'message' in decoded &&
			typeof decoded.status === 'number' &&
			typeof decoded.message === 'string'
		) {
			return { status: decoded.status, message: decoded.message };
		}
	} catch {
		return null;
	}

	return null;
}

export async function backend<T>(call: (me: Me) => T | Promise<T>): Promise<Awaited<T>> {
	const me = env.BACKEND.as(forwardedHeaders(getRequestEvent().request));
	try {
		return await call(me);
	} catch (cause) {
		const httpError = decodeHttpError(cause);
		if (httpError) {
			error(httpError.status, httpError.message);
		}
		throw cause;
	}
}

function parseSameSite(value: string): CookieOptions['sameSite'] {
	const normalized = value.toLowerCase();
	if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') {
		return normalized;
	}
	return undefined;
}

function parsePriority(value: string): CookieOptions['priority'] {
	const normalized = value.toLowerCase();
	if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
		return normalized;
	}
	return undefined;
}

function applyAttribute(options: CookieOptions, key: string, value: string) {
	switch (key) {
		case 'path':
			options.path = value || '/';
			break;
		case 'domain':
			options.domain = value || undefined;
			break;
		case 'max-age': {
			const maxAge = Number.parseInt(value, 10);
			if (Number.isFinite(maxAge)) {
				options.maxAge = maxAge;
			}
			break;
		}
		case 'expires': {
			const expires = new Date(value);
			if (!Number.isNaN(expires.getTime())) {
				options.expires = expires;
			}
			break;
		}
		case 'httponly':
			options.httpOnly = true;
			break;
		case 'secure':
			options.secure = true;
			break;
		case 'partitioned':
			options.partitioned = true;
			break;
		case 'samesite':
			options.sameSite = parseSameSite(value);
			break;
		case 'priority':
			options.priority = parsePriority(value);
			break;
		default:
			break;
	}
}

function parseSetCookie(header: string): SetCookie | null {
	const [pair = '', ...attributes] = header.split(';');
	const separator = pair.indexOf('=');
	const name = separator === -1 ? '' : pair.slice(0, separator).trim();
	if (!name) {
		return null;
	}

	const options: CookieOptions = { path: '/', httpOnly: false, secure: false };
	for (const attribute of attributes) {
		const equals = attribute.indexOf('=');
		const key = (equals === -1 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
		const value = equals === -1 ? '' : attribute.slice(equals + 1).trim();
		applyAttribute(options, key, value);
	}

	return { name, value: pair.slice(separator + 1).trim(), options };
}

function isExpired({ maxAge, expires }: CookieOptions) {
	if (maxAge !== undefined) {
		return maxAge <= 0;
	}
	return expires !== undefined && expires.getTime() <= Date.now();
}

const keepEncoded = (value: string) => value;

export function applySetCookies(setCookie: readonly string[]) {
	const { cookies } = getRequestEvent();
	for (const header of setCookie) {
		const cookie = parseSetCookie(header);
		if (!cookie) {
			continue;
		}

		if (isExpired(cookie.options)) {
			const { maxAge: _maxAge, expires: _expires, ...options } = cookie.options;
			cookies.delete(cookie.name, options);
		} else {
			cookies.set(cookie.name, cookie.value, { ...cookie.options, encode: keepEncoded });
		}
	}
}
