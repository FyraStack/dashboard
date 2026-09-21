import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { posthogProxyPath } from '$lib/analytics/posthog';

function posthogRegion(): 'us' | 'eu' {
	return env.PUBLIC_POSTHOG_HOST?.includes('eu.') ? 'eu' : 'us';
}

function upstreamHost(pathname: string): string {
	const region = posthogRegion();
	const isStaticAsset =
		pathname.startsWith(`${posthogProxyPath}/static/`) ||
		pathname.startsWith(`${posthogProxyPath}/array/`);
	return isStaticAsset ? `${region}-assets.i.posthog.com` : `${region}.i.posthog.com`;
}

function stripHopByHopHeaders(headers: Headers): Headers {
	const copy = new Headers(headers);
	copy.delete('content-encoding');
	copy.delete('content-length');
	copy.delete('transfer-encoding');
	return copy;
}

export const handlePostHogProxy: Handle = async ({ event, resolve }) => {
	const { pathname, search } = event.url;
	if (pathname !== posthogProxyPath && !pathname.startsWith(`${posthogProxyPath}/`)) {
		return resolve(event);
	}

	const hostname = upstreamHost(pathname);
	const upstreamUrl = `https://${hostname}${pathname.slice(posthogProxyPath.length) || '/'}${search}`;

	const headers = new Headers(event.request.headers);
	headers.set('host', hostname);
	headers.delete('cookie');
	headers.delete('authorization');
	headers.delete('accept-encoding');

	const clientIp = event.request.headers.get('cf-connecting-ip') ?? event.getClientAddress();
	if (clientIp) headers.set('x-forwarded-for', clientIp);

	const hasBody = event.request.method !== 'GET' && event.request.method !== 'HEAD';
	const upstream = await fetch(upstreamUrl, {
		method: event.request.method,
		headers,
		body: hasBody ? await event.request.arrayBuffer() : undefined,
		redirect: 'manual'
	});

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: stripHopByHopHeaders(upstream.headers)
	});
};
