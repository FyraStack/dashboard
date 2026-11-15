import { env, waitUntil } from 'cloudflare:workers';
import { handleErrorWithSentry, initCloudflareSentryHandle, sentryHandle } from '@sentry/sveltekit';
import { type RequestEvent, redirect } from '@sveltejs/kit';
import { type Handle, type HandleServerError, sequence } from '@sveltejs/kit/hooks';
import { authBasePath, passwordResetTokenCookie, sessionCookieNames } from 'stack-shared/auth';
import { isSerialConsolePath, resetPasswordPath } from 'stack-shared/routes';
import { applySetCookies, backend } from '#lib/server/backend.js';
import { captureServerException } from '#lib/server/posthog.js';
import { handlePostHogProxy } from '#lib/server/posthog-proxy.js';
import { dev } from '$app/env';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

const publicRoutes = [
	'/health',
	'/login',
	'/register',
	'/signup',
	'/forgot-password',
	resetPasswordPath,
	'/accept-invitation',
	'/internal'
];
const authPages = ['/login', '/register', '/signup', '/forgot-password'];
const remoteFunctionPath = '/_app/remote/';

function isUnderPath(pathname: string, base: string) {
	return pathname === base || pathname.startsWith(`${base}/`);
}

function isPublicRequest(event: RequestEvent) {
	return (
		event.route.id === null || publicRoutes.some((route) => isUnderPath(event.url.pathname, route))
	);
}

function isAuthPage(pathname: string) {
	return authPages.some((route) => isUnderPath(pathname, route));
}

function isAuthEndpoint(pathname: string) {
	return isUnderPath(pathname, authBasePath);
}

function hasSessionCookie(request: Request) {
	const cookie = request.headers.get('cookie');
	if (!cookie) {
		return false;
	}

	return cookie.split(';').some((part) => {
		const [name] = part.trimStart().split('=', 1);
		return sessionCookieNames.some((sessionCookieName) => sessionCookieName === name);
	});
}

async function proxyAuthRequest(request: Request) {
	const response = await env.BACKEND.fetch(request);
	return new Response(response.body, response);
}

const handleAuth: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (isAuthEndpoint(pathname)) {
		return proxyAuthRequest(event.request);
	}

	const isPublic = isPublicRequest(event);
	if (pathname.startsWith(remoteFunctionPath) || (isPublic && !hasSessionCookie(event.request))) {
		return resolve(event);
	}

	const { current, setCookie } = await backend((me) => me.session());
	applySetCookies(setCookie);
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

async function releaseBackend(event: RequestEvent) {
	try {
		const me = await event.locals.backend;
		await me?.release();
	} catch (cause) {
		console.warn('Failed to release backend caller', cause);
	}
}

function releaseAfterBody(response: Response, event: RequestEvent): Response {
	if (!response.body) {
		waitUntil(releaseBackend(event));
		return response;
	}

	const { readable, writable } = new TransformStream();
	waitUntil(response.body.pipeTo(writable).finally(() => releaseBackend(event)));
	return new Response(readable, response);
}

const handleBackendRelease: Handle = async ({ event, resolve }) => {
	let response: Response;
	try {
		response = await resolve(event);
	} catch (cause) {
		waitUntil(releaseBackend(event));
		throw cause;
	}
	return releaseAfterBody(response, event);
};

const handleSerialConsole: Handle = ({ event, resolve }) => {
	if (isSerialConsolePath(event.url.pathname)) {
		return env.BACKEND.fetch(event.request);
	}
	return resolve(event);
};

const passwordResetTokenMaxAge = 60 * 60;

const handlePasswordResetToken: Handle = ({ event, resolve }) => {
	const token = event.url.searchParams.get('token');
	if (event.url.pathname !== resetPasswordPath || !token) {
		return resolve(event);
	}

	event.cookies.set(passwordResetTokenCookie, token, {
		path: resetPasswordPath,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: passwordResetTokenMaxAge
	});
	redirect(303, resetPasswordPath);
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
	handleSerialConsole,
	handlePasswordResetToken,
	handleSentryInit,
	sentryHandle({ injectFetchProxyScript: false }),
	handlePostHogProxy,
	handleBackendRelease,
	handleAuth
);

const logServerError: HandleServerError = ({ kind, error, event }) => {
	if (kind !== 'unknown') {
		return;
	}

	console.error('Unhandled server error', { pathname: event.url.pathname, error });
	captureServerException(error, event);
};

export const handleError = handleErrorWithSentry(logServerError);
