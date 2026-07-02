import { redirect, type Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getCachedAuthSession, hasAuthSessionCookie } from '$lib/server/auth-lite';
import { closeRequestDb } from '$lib/server/db';
import { instrument, timingLog } from '$lib/server/observability';

const publicRoutes = ['/login', '/register', '/signup', '/accept-invitation', '/api/'];

const moduleLoadedAt = performance.now();
let isFirstRequestOnIsolate = true;

async function runFullAuth(
	event: Parameters<Handle>[0]['event'],
	resolve: Parameters<Handle>[0]['resolve'],
	requestAttrs: Record<string, string | number | boolean | undefined>
) {
	const [{ initAuth }, { svelteKitHandler }] = await instrument(
		'auth.full.import',
		() => Promise.all([import('$lib/server/auth'), import('better-auth/svelte-kit')]),
		requestAttrs
	);

	const auth = await instrument('auth.init', async () => initAuth(), requestAttrs);
	const session = await instrument(
		'auth.getSession',
		() => auth.api.getSession({ headers: event.request.headers }),
		requestAttrs
	);

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		event.locals.activeProjectId = session.session.activeOrganizationId ?? null;
	}

	const isPublic = publicRoutes.some((route) => event.url.pathname.startsWith(route));

	if (!session && !isPublic) {
		throw redirect(303, '/login');
	}

	if (session && isPublic && !event.url.pathname.startsWith('/api/')) {
		throw redirect(303, '/');
	}

	return await instrument(
		'sveltekit.handler',
		() => svelteKitHandler({ event, resolve, auth, building }),
		requestAttrs
	);
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const coldStart = isFirstRequestOnIsolate;
	isFirstRequestOnIsolate = false;
	const requestCf = (event.request as Request & { cf?: { colo?: string } }).cf;
	const requestAttrs = {
		'http.request.method': event.request.method,
		'url.pathname': event.url.pathname,
		'cf.colo': requestCf?.colo,
		'cf.placement': event.request.headers.get('cf-placement') ?? undefined,
		'cf.ray': event.request.headers.get('cf-ray') ?? undefined,
		'worker.cold_start': coldStart,
		'worker.module_age_ms': Math.round(performance.now() - moduleLoadedAt)
	};

	timingLog('request.handle.enter', requestAttrs);

	try {
		return await instrument(
			'request.handle',
			async () => {
				const isAuthEndpoint =
					event.url.pathname === '/api/auth' || event.url.pathname.startsWith('/api/auth/');
				if (event.url.pathname.startsWith('/api/internal/')) {
					timingLog('request.auth.bypassInternal', requestAttrs);
					return await instrument('sveltekit.resolve', () => resolve(event), requestAttrs);
				}

				const isPublic = publicRoutes.some((route) => event.url.pathname.startsWith(route));
				if (!isAuthEndpoint && isPublic && !hasAuthSessionCookie(event.request)) {
					timingLog('request.auth.publicNoSession', requestAttrs);
					return await instrument('sveltekit.resolve', () => resolve(event), requestAttrs);
				}

				const cached = isAuthEndpoint ? null : await getCachedAuthSession(event.request);

				if (!cached) {
					return await runFullAuth(event, resolve, requestAttrs);
				}

				event.locals.session = cached.session;
				event.locals.user = cached.user;
				event.locals.activeProjectId = cached.session.activeOrganizationId ?? null;

				if (!isPublic) {
					return await instrument('sveltekit.resolve', () => resolve(event), requestAttrs);
				}

				if (!event.url.pathname.startsWith('/api/')) {
					throw redirect(303, '/');
				}

				return await instrument('sveltekit.resolve', () => resolve(event), requestAttrs);
			},
			requestAttrs
		);
	} finally {
		timingLog('request.closeRequestDb.schedule', requestAttrs);
		closeRequestDb(event);
		timingLog('request.handle.exit', requestAttrs);
	}
};

export const handle: Handle = handleBetterAuth;
