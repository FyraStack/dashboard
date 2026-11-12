import ky, { type KyInstance } from 'ky';
import { getRuntimeEnv } from '#lib/server/env.js';
import { ServiceError, type ServiceErrorOptions } from '#lib/server/service-error.js';
import { createVpcFetch } from '#lib/server/vpc.js';

interface VyosApiResponse<T = unknown> {
	data: T;
	error: unknown;
	success: boolean;
}

interface VyosStaticIpv6Route {
	blackhole?: Record<string, never>;
	'next-hop'?: Record<string, { interface?: string }>;
}

interface VyosStaticIpv6Routes {
	route6?: Record<string, VyosStaticIpv6Route>;
}

interface VyosStaticRouteParams {
	description?: string;
	destination: string;
	gateway: string;
}

const TRAILING_SLASHES = /\/+$/;
const COMMIT_TIMEOUT_MS = 120_000;

class VyosError extends ServiceError {
	constructor(message: string, options: ServiceErrorOptions) {
		super(message, options);
		this.name = 'VyosError';
	}
}

function getVyosConfig() {
	const env = getRuntimeEnv();
	if (!(env.VYOS_API_URL && env.VYOS_API_KEY)) {
		return null;
	}

	return {
		apiUrl: env.VYOS_API_URL.replace(TRAILING_SLASHES, ''),
		apiKey: env.VYOS_API_KEY,
		fetch: createVpcFetch([env.VYOS_VPC_01, env.VYOS_VPC_02], env.VYOS_USE_VPC)
	};
}

export function isVyosConfigured() {
	return getVyosConfig() !== null;
}

export class VyosClient {
	private readonly api: KyInstance;
	private readonly apiKey: string;

	constructor() {
		const config = getVyosConfig();
		if (!config) {
			throw new Error("Couldn't get VyOS config");
		}

		this.apiKey = config.apiKey;

		this.api = ky.create({
			prefix: `${config.apiUrl}`,
			headers: {
				Accept: 'application/json'
			},
			timeout: 30_000,
			// Handle non-2xx ourselves so the router/proxy error body is readable.
			throwHttpErrors: false,
			fetch: config.fetch
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

	private async post<T = unknown>(
		endpoint: string,
		data: Record<string, unknown>,
		options: { timeout?: number } = {}
	) {
		const response = await this.api.post(endpoint, {
			body: this.toForm(data),
			...options
		});
		const raw = await response.text();

		let parsed: VyosApiResponse<T>;
		try {
			parsed = JSON.parse(raw) as VyosApiResponse<T>;
		} catch (parseError) {
			throw new VyosError(
				`VyOS ${endpoint} returned a non-JSON response (router proxy unreachable?)`,
				{ status: response.status, details: raw.slice(0, 500), cause: parseError }
			);
		}

		if (!(response.ok && parsed.success)) {
			throw new VyosError(`VyOS ${endpoint} request failed`, {
				status: response.status,
				details: parsed.error ?? parsed
			});
		}

		return parsed;
	}

	private static routeHasNextHop(route: VyosStaticIpv6Route | undefined, gateway: string): boolean {
		return route?.['next-hop'] !== undefined && gateway in route['next-hop'];
	}

	private async getStaticIpv6Routes(): Promise<VyosStaticIpv6Routes> {
		let response: VyosApiResponse<VyosStaticIpv6Routes | null>;
		try {
			response = await this.post<VyosStaticIpv6Routes | null>('retrieve', {
				op: 'showConfig',
				path: ['protocols', 'static', 'route6']
			});
		} catch (err) {
			if (err instanceof VyosError && err.status === 400 && String(err.details).includes('empty')) {
				return {};
			}
			throw err;
		}

		return response.data ?? {};
	}

	private async saveConfig() {
		await this.post('config-file', { op: 'save' }, { timeout: COMMIT_TIMEOUT_MS });
	}

	async createDelegatedRoute(params: VyosStaticRouteParams): Promise<VyosApiResponse | null> {
		const existingRoutes = await this.getStaticIpv6Routes();
		const existingRoute = existingRoutes.route6?.[params.destination];

		if (VyosClient.routeHasNextHop(existingRoute, params.gateway)) {
			await this.saveConfig();
			return null;
		}

		if (existingRoute) {
			await this.deleteDelegatedRouteWithoutSavingConfig(params.destination);
		}

		const response = await this.post(
			'configure',
			{
				op: 'set',
				path: ['protocols', 'static', 'route6', params.destination, 'next-hop', params.gateway]
			},
			{ timeout: COMMIT_TIMEOUT_MS }
		);
		await this.saveConfig();
		return response;
	}

	async deleteDelegatedRoute(destination: string): Promise<VyosApiResponse | null> {
		const existingRoutes = await this.getStaticIpv6Routes();
		if (!existingRoutes.route6?.[destination]) {
			return null;
		}

		const response = await this.deleteDelegatedRouteWithoutSavingConfig(destination);
		await this.saveConfig();
		return response;
	}

	private async deleteDelegatedRouteWithoutSavingConfig(
		destination: string
	): Promise<VyosApiResponse | null> {
		return await this.post(
			'configure',
			{
				op: 'delete',
				path: ['protocols', 'static', 'route6', destination]
			},
			{ timeout: COMMIT_TIMEOUT_MS }
		);
	}
}
