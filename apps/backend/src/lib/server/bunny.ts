import ky, { type KyInstance } from 'ky';
import { getRuntimeEnv } from '#lib/server/env.js';
import { ServiceError, type ServiceErrorOptions } from '#lib/server/service-error.js';

const DNS_RECORD_TYPE_PTR = 10;
const PTR_RECORD_TTL_SECONDS = 300;

interface BunnyDnsZone {
	Domain: string;
	Id: number;
}

interface BunnyDnsZoneList {
	CurrentPage: number;
	HasMoreItems: boolean;
	Items: BunnyDnsZone[];
}

interface BunnyDnsRecord {
	Id: number;
	Name: string;
	Type: number;
	Value: string;
}

export class BunnyError extends ServiceError {
	constructor(message: string, options: ServiceErrorOptions) {
		super(message, options);
		this.name = 'BunnyError';
	}
}

function getBunnyConfig() {
	const env = getRuntimeEnv();
	if (!env.BUNNY_API_KEY) {
		return null;
	}

	return { apiKey: env.BUNNY_API_KEY };
}

export function isBunnyConfigured() {
	return getBunnyConfig() !== null;
}

function ptrRecordBody(name: string, value: string) {
	return { Type: DNS_RECORD_TYPE_PTR, Name: name, Value: value, Ttl: PTR_RECORD_TTL_SECONDS };
}

export class BunnyClient {
	private readonly api: KyInstance;

	constructor() {
		const config = getBunnyConfig();
		if (!config) {
			throw new Error('Bunny.net API key is not configured');
		}

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
			throw new BunnyError(`Bunny ${method.toUpperCase()} ${endpoint} failed`, {
				status: response.status,
				details: raw.slice(0, 500)
			});
		}
		if (!raw) {
			return undefined as T;
		}

		try {
			return JSON.parse(raw) as T;
		} catch (parseError) {
			throw new BunnyError(
				`Bunny ${method.toUpperCase()} ${endpoint} returned a non-JSON response`,
				{ status: response.status, details: raw.slice(0, 500), cause: parseError }
			);
		}
	}

	async listDnsZones(search?: string): Promise<BunnyDnsZone[]> {
		const zones: BunnyDnsZone[] = [];
		for (let page = 1; page <= 10; page += 1) {
			// biome-ignore lint/performance/noAwaitInLoops: each page request depends on the previous page's HasMoreItems
			const result = await this.request<BunnyDnsZoneList>('get', 'dnszone', {
				searchParams: {
					page: String(page),
					perPage: '1000',
					...(search ? { search } : {})
				}
			});
			zones.push(...(result.Items ?? []));
			if (!result.HasMoreItems) {
				break;
			}
		}
		return zones;
	}

	async findDnsZone(domain: string): Promise<BunnyDnsZone | null> {
		const normalized = domain.trim().toLowerCase();
		const zones = await this.listDnsZones(normalized);
		return zones.find((zone) => zone.Domain.toLowerCase() === normalized) ?? null;
	}

	createPtrRecord(zoneId: number, name: string, value: string): Promise<BunnyDnsRecord> {
		return this.request<BunnyDnsRecord>('put', `dnszone/${zoneId}/records`, {
			json: ptrRecordBody(name, value)
		});
	}

	async updatePtrRecord(zoneId: number, recordId: number, name: string, value: string) {
		await this.request('post', `dnszone/${zoneId}/records/${recordId}`, {
			json: ptrRecordBody(name, value)
		});
	}

	async deleteRecord(zoneId: number, recordId: number) {
		const response = await this.api.delete(`dnszone/${zoneId}/records/${recordId}`);
		if (!response.ok && response.status !== 404) {
			const raw = await response.text();
			throw new BunnyError(`Bunny DELETE dnszone/${zoneId}/records/${recordId} failed`, {
				status: response.status,
				details: raw.slice(0, 500)
			});
		}
	}
}
