import ky, { type KyInstance } from 'ky';
import { getRuntimeEnv } from '#lib/server/env.js';
import { createVpcFetch, insecureDirectFetch } from '#lib/server/vpc.js';

interface VyosApiResponse<T = unknown> {
	data: T;
	error: unknown;
	success: boolean;
}

type VyosCommandResponse = VyosApiResponse;

interface VyosStaticIpv6Route {
	blackhole?: Record<string, never>;
	'next-hop'?: Record<string, { interface?: string }>;
}

interface VyosStaticIpv6Routes {
	route6?: Record<string, VyosStaticIpv6Route>;
}

export interface VyosStaticNeighborParams {
	description: string;
	ipaddress: string;
	macAddress: string;
}

export interface VyosStaticRouteParams {
	description?: string;
	destination: string;
	gateway: string;
}

const TRAILING_SLASHES = /\/+$/;

function stringifyErrorDetails(details: unknown): string {
	try {
		return JSON.stringify(details);
	} catch {
		return 'Unable to stringify details';
	}
}

export class VyosError extends Error {
	readonly status: number;
	readonly details: unknown;

	constructor(message: string, options: ErrorOptions & { status: number; details: unknown }) {
		const { status, details } = options;
		super(`${message} - ${status} - ${stringifyErrorDetails(details)}`, options);
		this.name = 'VyosError';
		this.status = status;
		this.details = details;
	}
}

function getVyosConfig() {
	const env = getRuntimeEnv();
	if (!(env.VYOS_API_URL && env.VYOS_API_KEY)) {
		return null;
	}

	const routersInFailoverOrder =
		env.VYOS_USE_VPC === 'false' ? [] : [env.VYOS_VPC_01, env.VYOS_VPC_02];

	return {
		apiUrl: env.VYOS_API_URL.replace(TRAILING_SLASHES, ''),
		apiKey: env.VYOS_API_KEY,
		verifySsl: env.VYOS_VERIFY_SSL !== 'false',
		routersInFailoverOrder
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
			throw new VyosError("Couldn't get VyOS config", { status: 500, details: '' });
		}

		this.apiKey = config.apiKey;

		const directFetch = config.verifySsl ? globalThis.fetch : insecureDirectFetch;

		this.api = ky.create({
			prefix: `${config.apiUrl}`,
			headers: {
				Accept: 'application/json'
			},
			timeout: 30_000,
			// Handle non-2xx ourselves so the router/proxy error body is readable.
			throwHttpErrors: false,
			fetch: createVpcFetch(config.routersInFailoverOrder, directFetch)
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
		const response = await this.api.post(endpoint, {
			body: this.toForm(data)
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

	async getStaticIpv6Routes(): Promise<VyosStaticIpv6Routes> {
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
		if (!existingRoutes.route6?.[destination]) {
			return null;
		}

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
