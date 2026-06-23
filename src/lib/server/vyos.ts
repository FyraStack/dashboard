import { getRuntimeEnv } from '$lib/server/env';
import ky, { type KyInstance } from 'ky';
import { Agent } from 'undici';

type VyosApiResponse<T = unknown> = {
	success: boolean;
	data: T;
	error: unknown;
};

type VyosCommandResponse = VyosApiResponse;

type VyosStaticIpv6Route = {
	blackhole?: Record<string, never>;
	'next-hop'?: Record<string, { interface?: string }>;
};

type VyosStaticIpv6Routes = {
	route6?: Record<string, VyosStaticIpv6Route>;
};

export type VyosStaticNeighborParams = {
	ipaddress: string;
	macAddress: string;
	description: string;
};

export type VyosStaticRouteParams = {
	destination: string;
	gateway: string;
	description?: string;
};

export class VyosError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly details: unknown
	) {
		let detailsString;
		try {
			detailsString = JSON.stringify(details);
		} catch {
			detailsString = 'Unable to stringify details';
		}

		super(`${message} - ${status} - ${detailsString}`);
		this.name = 'VyosError';
	}
}

function getVyosConfig() {
	const env = getRuntimeEnv();
	if (!env.VYOS_API_URL || !env.VYOS_API_KEY) return null;

	return {
		apiUrl: env.VYOS_API_URL.replace(/\/+$/, ''),
		apiKey: env.VYOS_API_KEY,
		verifySsl: env.VYOS_VERIFY_SSL !== 'false'
	};
}

export function isVyosConfigured() {
	return getVyosConfig() !== null;
}

export class VyosClient {
	private api: KyInstance;
	private apiKey: string;

	constructor() {
		const config = getVyosConfig();
		if (!config) throw new VyosError("Couldn't get VyOS config", 500, '');

		this.apiKey = config.apiKey;

		const insecureAgent = config.verifySsl
			? undefined
			: new Agent({ connect: { rejectUnauthorized: false } });
		const insecureFetch = insecureAgent
			? (input: RequestInfo | URL, init?: RequestInit) =>
					fetch(input, {
						...init,
						// @ts-expect-error -- Node/undici dispatcher extension
						dispatcher: insecureAgent
					})
			: undefined;

		this.api = ky.create({
			prefix: `${config.apiUrl}`,
			headers: {
				Accept: 'application/json'
			},
			timeout: 30_000,
			...(insecureFetch ? { fetch: insecureFetch } : {})
		});
	}

	/**
	 * VyOS API expects form-encoded POST bodies with a JSON `data` field and
	 * plaintext API key in the `key` field.
	 */
	private toForm(data: Record<string, unknown>): URLSearchParams {
		const form = new URLSearchParams();
		form.append('data', JSON.stringify(data));
		form.append('key', this.apiKey);
		return form;
	}

	private async post<T = unknown>(endpoint: string, data: Record<string, unknown>) {
		const response = await this.api
			.post(endpoint, {
				body: this.toForm(data)
			})
			.json<VyosApiResponse<T>>();

		if (!response.success) {
			throw new VyosError(`VyOS ${endpoint} request failed`, 500, response.error ?? response);
		}

		return response;
	}

	private static routeHasNextHop(route: VyosStaticIpv6Route | undefined, gateway: string): boolean {
		return route?.['next-hop'] !== undefined && gateway in route['next-hop'];
	}

	async getStaticIpv6Routes(): Promise<VyosStaticIpv6Routes> {
		const response = await this.post<VyosStaticIpv6Routes | null>('retrieve', {
			op: 'showConfig',
			path: ['protocols', 'static', 'route6']
		});

		return response.data ?? {};
	}

	private async saveConfig() {
		await this.post('config-file', { op: 'save' });
	}

	async createDelegatedRoute(params: VyosStaticRouteParams): Promise<VyosCommandResponse | null> {
		const existingRoutes = await this.getStaticIpv6Routes();
		const existingRoute = existingRoutes.route6?.[params.destination];

		if (VyosClient.routeHasNextHop(existingRoute, params.gateway)) {
			return null;
		}

		if (existingRoute) {
			await this.deleteDelegatedRouteWithoutSavingConfig(params.destination);
		}

		const response = await this.post('configure', {
			op: 'set',
			path: ['protocols', 'static', 'route6', params.destination, 'next-hop', params.gateway]
		});
		await this.saveConfig();
		return response;
	}

	async deleteDelegatedRoute(destination: string): Promise<VyosCommandResponse | null> {
		const existingRoutes = await this.getStaticIpv6Routes();
		if (!existingRoutes.route6?.[destination]) return null;

		const response = await this.deleteDelegatedRouteWithoutSavingConfig(destination);
		await this.saveConfig();
		return response;
	}

	private async deleteDelegatedRouteWithoutSavingConfig(
		destination: string
	): Promise<VyosCommandResponse | null> {
		return await this.post('configure', {
			op: 'delete',
			path: ['protocols', 'static', 'route6', destination]
		});
	}
}
