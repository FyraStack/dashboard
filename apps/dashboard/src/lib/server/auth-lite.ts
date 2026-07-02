import { dev } from '$app/environment';
import { getRuntimeEnv } from '$lib/server/env';
import { instrument, timingLog } from '$lib/server/observability';

type CachedSession = {
	session: NonNullable<App.Locals['session']>;
	user: NonNullable<App.Locals['user']>;
	updatedAt: number;
	version?: string;
};

const sessionCookieNames = new Set([
	'better-auth.session_token',
	'__Secure-better-auth.session_token',
	'better-auth-session_token',
	'__Secure-better-auth-session_token'
]);

export function hasAuthSessionCookie(request: Request): boolean {
	const cookie = request.headers.get('cookie');
	if (!cookie) return false;

	for (const part of cookie.split(';')) {
		const name = part.trimStart().split('=', 1)[0];
		if (sessionCookieNames.has(name)) return true;
	}

	return false;
}

function toDate(value: unknown): Date {
	return value instanceof Date ? value : new Date(String(value));
}

function normalizeSession(
	session: NonNullable<App.Locals['session']>
): NonNullable<App.Locals['session']> {
	return {
		...session,
		expiresAt: toDate(session.expiresAt),
		createdAt: toDate(session.createdAt),
		updatedAt: toDate(session.updatedAt)
	};
}

function normalizeUser(user: NonNullable<App.Locals['user']>): NonNullable<App.Locals['user']> {
	return {
		...user,
		createdAt: toDate(user.createdAt),
		updatedAt: toDate(user.updatedAt)
	};
}

export async function getCachedAuthSession(request: Request): Promise<CachedSession | null> {
	const started = performance.now();
	const { getCookieCache, getSessionCookie } = await instrument(
		'auth.cookieCache.import',
		() => import('better-auth/cookies'),
		{ 'auth.cookie_cache.strategy': 'compact' }
	);

	if (!getSessionCookie(request)) {
		timingLog('auth.cookieCache.noSessionCookie', {
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return null;
	}

	const cached = await instrument(
		'auth.cookieCache.get',
		() =>
			getCookieCache<CachedSession>(request, {
				secret: getRuntimeEnv().BETTER_AUTH_SECRET,
				isSecure: !dev,
				strategy: 'compact'
			}),
		{ 'auth.cookie_cache.strategy': 'compact' }
	);

	if (!cached?.session || !cached.user) {
		timingLog('auth.cookieCache.miss', {
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return null;
	}

	const session = normalizeSession(cached.session);
	if (session.expiresAt < new Date()) {
		timingLog('auth.cookieCache.expired', {
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return null;
	}

	timingLog('auth.cookieCache.hit', {
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return {
		...cached,
		session,
		user: normalizeUser(cached.user)
	};
}
