import { instrument } from '#lib/server/observability.js';

export type VpcFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

export function createVpcFetch(
	services: Array<Fetcher | undefined>,
	useVpcFlag?: string
): VpcFetch {
	const orderedServices =
		useVpcFlag === 'false'
			? []
			: services.filter((service): service is Fetcher => Boolean(service));
	if (orderedServices.length === 0) {
		return (input, init) => fetch(input, init);
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
