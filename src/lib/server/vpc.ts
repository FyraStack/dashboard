import type { Fetcher } from '@cloudflare/workers-types';
import { Agent } from 'undici';

export type VpcFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const tlsTolerantAgent = new Agent({ connect: { rejectUnauthorized: false } });

export const insecureDirectFetch: VpcFetch = (input, init) =>
	fetch(input, {
		...init,
		// @ts-expect-error -- undici dispatcher is a Node-only RequestInit extension
		dispatcher: tlsTolerantAgent
	});

/**
 * Service bindings (Fetcher) reject `Request` instances created in another
 * realm — under miniflare a Node-realm `Request` is coerced to the string
 * "[object Request]" and parsed as a URL, which throws. Normalize any input
 * into a `(url, init)` pair, which bindings accept regardless of realm. The
 * body is buffered once so it can be replayed across failover attempts.
 */
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
	if (orderedServices.length === 0) return fallback;

	return async (input, init) => {
		const [url, normalizedInit] = await toUrlAndInit(input, init);
		let lastError: unknown;

		for (const service of orderedServices) {
			const send = service.fetch.bind(service) as unknown as VpcFetch;

			try {
				return await send(url, normalizedInit);
			} catch (error) {
				lastError = error;
			}
		}

		throw lastError;
	};
}
