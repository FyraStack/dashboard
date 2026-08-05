import ky, { type KyInstance } from 'ky';
import { getRuntimeEnv } from '$lib/server/env';

export const bunnyDnsRecordTypePtr = 10;

export type BunnyDnsZone = {
	Id: number;
	Domain: string;
};

type BunnyDnsZoneList = {
	Items: BunnyDnsZone[];
	CurrentPage: number;
	HasMoreItems: boolean;
};

export type BunnyDnsRecord = {
	Id: number;
	Type: number;
	Name: string;
	Value: string;
};

export class BunnyError extends Error {
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
		this.name = 'BunnyError';
	}
}

function getBunnyConfig() {
	const env = getRuntimeEnv();
	if (!env.BUNNY_API_KEY) return null;

	return { apiKey: env.BUNNY_API_KEY };
}

export function isBunnyConfigured() {
	return getBunnyConfig() !== null;
}

export class BunnyClient {
	private api: KyInstance;

	constructor() {
		const config = getBunnyConfig();
		if (!config) throw new BunnyError('Bunny.net API key is not configured', 500, '');

		this.api = ky.create({
			prefix: 'https://api.bunny.net',
			headers: {
				AccessKey: config.apiKey,
				Accept: 'application/json'
			},
			timeout: 30_000,
			throwHttpErrors: false
		});
	}

	private async request<T = unknown>(
		method: 'get' | 'put' | 'post' | 'delete',
		endpoint: string,
		options: { json?: unknown; searchParams?: Record<string, string> } = {}
	): Promise<T> {
		const response = await this.api[method](endpoint, options);
		const raw = await response.text();

		if (!response.ok) {
			throw new BunnyError(
				`Bunny ${method.toUpperCase()} ${endpoint} failed`,
				response.status,
				raw.slice(0, 500)
			);
		}
		if (!raw) return undefined as T;

		try {
			return JSON.parse(raw) as T;
		} catch {
			throw new BunnyError(
				`Bunny ${method.toUpperCase()} ${endpoint} returned a non-JSON response`,
				response.status,
				raw.slice(0, 500)
			);
		}
	}

	async listDnsZones(search?: string): Promise<BunnyDnsZone[]> {
		const zones: BunnyDnsZone[] = [];
		for (let page = 1; page <= 10; page++) {
			const result = await this.request<BunnyDnsZoneList>('get', 'dnszone', {
				searchParams: {
					page: String(page),
					perPage: '1000',
					...(search ? { search } : {})
				}
			});
			zones.push(...(result.Items ?? []));
			if (!result.HasMoreItems) break;
		}
		return zones;
	}

	async findDnsZone(domain: string): Promise<BunnyDnsZone | null> {
		const normalized = domain.trim().toLowerCase();
		const zones = await this.listDnsZones(normalized);
		return zones.find((zone) => zone.Domain.toLowerCase() === normalized) ?? null;
	}

	async createPtrRecord(zoneId: number, name: string, value: string): Promise<BunnyDnsRecord> {
		return this.request<BunnyDnsRecord>('put', `dnszone/${zoneId}/records`, {
			json: { Type: bunnyDnsRecordTypePtr, Name: name, Value: value, Ttl: 300 }
		});
	}

	async updatePtrRecord(zoneId: number, recordId: number, name: string, value: string) {
		await this.request('post', `dnszone/${zoneId}/records/${recordId}`, {
			json: { Type: bunnyDnsRecordTypePtr, Name: name, Value: value, Ttl: 300 }
		});
	}

	async deleteRecord(zoneId: number, recordId: number) {
		const response = await this.api.delete(`dnszone/${zoneId}/records/${recordId}`);
		if (!response.ok && response.status !== 404) {
			const raw = await response.text();
			throw new BunnyError(
				`Bunny DELETE dnszone/${zoneId}/records/${recordId} failed`,
				response.status,
				raw.slice(0, 500)
			);
		}
	}
}
