import ky from 'ky';
import { instrument } from '#lib/server/observability.js';

export type VpcFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

declare const __INSECURE_FETCH_URL__: string;

async function devInsecureFetch(input: RequestInfo | URL, init?: RequestInit) {
	const [url, normalizedInit] = await toUrlAndInit(input, init);
	const headers = new Headers(normalizedInit?.headers);
	headers.set('x-target-url', url);
	return fetch(__INSECURE_FETCH_URL__, { ...normalizedInit, headers });
}

export const insecureDirectFetch: VpcFetch = (input, init) =>
	import.meta.env.DEV
		? ky(input, { ...init, retry: 0, throwHttpErrors: false, fetch: devInsecureFetch })
		: ky(input, { ...init, retry: 0, throwHttpErrors: false });

async function toUrlAndInit(
	input: RequestInfo | URL,
	init?: RequestInit
): Promise<[string, RequestInit | undefined]> {
	if (input instanceof Request) {
		const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
		const body = hasBody ? await input.arrayBuffer() : undefined;
		return [
			input.url,
			{ method: input.method, headers: new Headers(input.headers), body, ...init }
		];
	}

	return [input instanceof URL ? input.toString() : input, init];
}

export function createVpcFetch(services: Array<Fetcher | undefined>, fallback: VpcFetch): VpcFetch {
	const orderedServices = services.filter((service): service is Fetcher => Boolean(service));
	if (orderedServices.length === 0) {
		return fallback;
	}

	return async (input, init) => {
		const [url, normalizedInit] = await toUrlAndInit(input, init);

		return instrument(
			'vpc.fetch',
			async () => {
				let lastError: unknown;

				for (const service of orderedServices) {
					const send = service.fetch.bind(service) as unknown as VpcFetch;

					try {
						// biome-ignore lint/performance/noAwaitInLoops: routers are tried in failover order and only on failure of the previous one
						return await send(url, normalizedInit);
					} catch (error) {
						lastError = error;
					}
				}

				throw lastError;
			},
			{ 'http.url': url, 'http.request.method': normalizedInit?.method ?? 'GET' }
		);
	};
}
