import { env } from 'cloudflare:workers';
import { handleErrorWithSentry, initCloudflareSentryHandle, sentryHandle } from '@sentry/sveltekit';
import { type RequestEvent, redirect } from '@sveltejs/kit';
import { type Handle, type HandleServerError, sequence } from '@sveltejs/kit/hooks';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureSession,
	accessibilityFixtureUser
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { handlePostHogProxy } from '#lib/server/posthog-proxy.js';
import { dev } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

const publicRoutes = [
	'/health',
	'/login',
	'/register',
	'/signup',
	'/forgot-password',
	'/reset-password',
	'/accept-invitation',
	'/api/',
	'/internal/',
	'/_app/remote/'
];
const authPages = ['/login', '/register', '/signup', '/forgot-password'];
const authBasePath = '/api/auth';
const remoteFunctionPath = '/_app/remote/';
const sessionCookieNames = new Set([
	'better-auth.session_token',
	'__Secure-better-auth.session_token',
	'better-auth-session_token',
	'__Secure-better-auth-session_token'
]);

function isPublicRequest(event: RequestEvent) {
	return (
		event.route.id === null || publicRoutes.some((route) => event.url.pathname.startsWith(route))
	);
}

function isAuthPage(pathname: string) {
	return authPages.some((route) => pathname.startsWith(route));
}

function isAuthEndpoint(pathname: string) {
	return pathname === authBasePath || pathname.startsWith(`${authBasePath}/`);
}

function hasSessionCookie(request: Request) {
	const cookie = request.headers.get('cookie');
	if (!cookie) {
		return false;
	}

	return cookie.split(';').some((part) => {
		const [name] = part.trimStart().split('=', 1);
		return sessionCookieNames.has(name);
	});
}

async function proxyAuthRequest(request: Request) {
	const response = await env.BACKEND.fetch(request);
	return new Response(response.body, response);
}

const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (accessibilityFixtureEnabled && !isAuthPage(pathname)) {
		event.locals.session = accessibilityFixtureSession;
		event.locals.user = accessibilityFixtureUser;
		event.locals.activeProjectId = accessibilityFixtureSession.activeOrganizationId;
		return resolve(event);
	}

	if (isAuthEndpoint(pathname)) {
		return proxyAuthRequest(event.request);
	}

	const isPublic = isPublicRequest(event);
	if (pathname.startsWith(remoteFunctionPath) || (isPublic && !hasSessionCookie(event.request))) {
		return resolve(event);
	}

	const current = await backend((me) => me.session());
	if (current) {
		event.locals.session = current.session;
		event.locals.user = current.user;
		event.locals.activeProjectId = current.session.activeOrganizationId ?? null;
	}

	if (!(current || isPublic)) {
		redirect(303, '/login');
	}

	if (current && isAuthPage(pathname)) {
		redirect(303, '/');
	}

	return resolve(event);
};

let sentryRequestHandle: Handle | undefined;

const handleSentryInit: Handle = (input) => {
	if (!PUBLIC_SENTRY_DSN) {
		return input.resolve(input.event);
	}

	const requestHandle =
		sentryRequestHandle ??
		initCloudflareSentryHandle({
			dsn: PUBLIC_SENTRY_DSN,
			tracesSampleRate: dev ? 1.0 : 0.1,
			environment: dev ? 'development' : 'production'
		});
	sentryRequestHandle = requestHandle;
	return requestHandle(input);
};

export const handle: Handle = sequence(
	handleSentryInit,
	sentryHandle({ injectFetchProxyScript: false }),
	handlePostHogProxy,
	handleAuth
);

const logServerError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') {
		return;
	}

	console.error('Unhandled server error', { pathname: event.url.pathname, error });
};

export const handleError = handleErrorWithSentry(logServerError);
