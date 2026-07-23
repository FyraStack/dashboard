import ky, { HTTPError, type KyInstance } from 'ky';
import type { Fetcher } from '@cloudflare/workers-types';
import { createVpcFetch, insecureDirectFetch } from '$lib/server/vpc';
import type {
	PveResponse,
	PveNode,
	PveQemuVm,
	PveQemuConfig,
	PveQemuStatus,
	PveQemuRrdData,
	PveStorage,
	PveStorageContent,
	PveTaskStatus,
	PveNextId,
	PveCreateQemuParams,
	PveClusterResource,
	PveAgentNetworkInterface
} from './types';

export interface ProxmoxClientConfig {
	baseUrl: string;
	tokenId: string;
	tokenSecret: string;
	verifySsl?: boolean;
	vpc?: Fetcher;
}

export class ProxmoxClient {
	private api: KyInstance;

	constructor(config: ProxmoxClientConfig) {
		const { baseUrl, tokenId, tokenSecret, verifySsl = true, vpc } = config;

		const usingInsecureDirectFetch = !vpc && !verifySsl;
		const directFetch = usingInsecureDirectFetch ? insecureDirectFetch : globalThis.fetch;

		this.api = ky.create({
			prefix: `${baseUrl.replace(/\/+$/, '')}/api2/json`,
			headers: {
				Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
				Accept: 'application/json',
				...(usingInsecureDirectFetch ? { 'Accept-Encoding': 'identity' } : {})
			},
			timeout: 30_000,
			fetch: createVpcFetch(vpc ? [vpc] : [], directFetch)
		});
	}

	/**
	 * Proxmox PVE API requires application/x-www-form-urlencoded for POST/PUT.
	 * Passing URLSearchParams as the body lets fetch set the correct Content-Type.
	 */
	private toForm(params: Record<string, unknown>): URLSearchParams {
		const form = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				form.append(key, String(value));
			}
		}
		return form;
	}

	private async logHttpError(context: string, error: unknown, payload?: Record<string, unknown>) {
		if (!(error instanceof HTTPError)) {
			return;
		}

		let body: unknown;
		try {
			body = await error.response.clone().json();
		} catch {
			try {
				body = await error.response.clone().text();
			} catch {
				body = '<unreadable response body>';
			}
		}

		console.error(`[Proxmox] ${context} failed`, {
			url: error.request.url,
			method: error.request.method,
			status: error.response.status,
			statusText: error.response.statusText,
			payload,
			body
		});
	}

	// Nodes

	async listNodes(): Promise<PveNode[]> {
		const res = await this.api.get('nodes').json<PveResponse<PveNode[]>>();
		return res.data;
	}

	async getNode(node: string): Promise<PveNode> {
		const nodes = await this.listNodes();
		const found = nodes.find((n) => n.node === node);
		if (!found) throw new Error(`Proxmox node "${node}" not found`);
		return found;
	}

	// QEMU VMs

	async listQemuVms(node: string): Promise<PveQemuVm[]> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/qemu`)
			.json<PveResponse<PveQemuVm[]>>();
		return res.data;
	}

	async getQemuVm(node: string, vmid: number): Promise<PveQemuStatus> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/current`)
			.json<PveResponse<PveQemuStatus>>();
		return res.data;
	}

	async getQemuConfig(node: string, vmid: number): Promise<PveQemuConfig> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`)
			.json<PveResponse<PveQemuConfig>>();
		return res.data;
	}

	async getQemuRrdData(
		node: string,
		vmid: number,
		params: { timeframe: 'hour' | 'day' | 'week' | 'month' | 'year'; cf?: 'AVERAGE' | 'MAX' }
	): Promise<PveQemuRrdData[]> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/rrddata`, {
				searchParams: {
					timeframe: params.timeframe,
					cf: params.cf ?? 'AVERAGE'
				}
			})
			.json<PveResponse<PveQemuRrdData[]>>();
		return res.data;
	}

	async createQemuVm(node: string, params: PveCreateQemuParams): Promise<string> {
		try {
			const res = await this.api
				.post(`nodes/${encodeURIComponent(node)}/qemu`, {
					body: this.toForm(params as Record<string, unknown>),
					timeout: 120_000
				})
				.json<PveResponse<string>>();
			return res.data;
		} catch (error) {
			await this.logHttpError(`createQemuVm(${node})`, error, params as Record<string, unknown>);
			throw error;
		}
	}

	/**
	 * Async config update — POST (not PUT) returns a UPID so heavy ops like
	 * import-from run as a background task instead of blocking the response.
	 */
	async updateQemuConfigAsync(
		node: string,
		vmid: number,
		params: Record<string, unknown>
	): Promise<string> {
		try {
			const res = await this.api
				.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
					body: this.toForm(params)
				})
				.json<PveResponse<string>>();
			return res.data;
		} catch (error) {
			await this.logHttpError(`updateQemuConfigAsync(${node}, ${vmid})`, error, params);
			throw error;
		}
	}

	async resizeDisk(node: string, vmid: number, disk: string, size: string): Promise<void> {
		await this.api
			.put(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/resize`, {
				body: this.toForm({ disk, size })
			})
			.json<PveResponse<null>>();
	}

	async updateQemuFirewallOptions(
		node: string,
		vmid: number,
		params: {
			enable?: 0 | 1;
			ipfilter?: 0 | 1;
			macfilter?: 0 | 1;
			ndp?: 0 | 1;
			dhcp?: 0 | 1;
			policy_in?: 'ACCEPT' | 'DROP' | 'REJECT';
			policy_out?: 'ACCEPT' | 'DROP' | 'REJECT';
		}
	): Promise<void> {
		await this.api
			.put(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/options`, {
				body: this.toForm(params)
			})
			.json<PveResponse<null>>();
	}

	async createQemuFirewallIpset(node: string, vmid: number, name: string): Promise<void> {
		try {
			await this.api
				.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/ipset`, {
					body: this.toForm({ name })
				})
				.json<PveResponse<null>>();
		} catch (error) {
			if (error instanceof HTTPError && error.response.status === 400) return;
			await this.logHttpError(`createQemuFirewallIpset(${node}, ${vmid}, ${name})`, error, {
				name
			});
			throw error;
		}
	}

	async addQemuFirewallIpsetEntry(
		node: string,
		vmid: number,
		name: string,
		cidr: string,
		comment?: string
	): Promise<void> {
		await this.api
			.post(
				`nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/ipset/${encodeURIComponent(name)}`,
				{
					body: this.toForm({ cidr, comment })
				}
			)
			.json<PveResponse<null>>();
	}

	async addQemuFirewallSecurityGroupRule(node: string, vmid: number, group: string): Promise<void> {
		await this.api
			.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/firewall/rules`, {
				body: this.toForm({ type: 'group', action: group, enable: 1 })
			})
			.json<PveResponse<null>>();
	}

	async deleteQemuVm(
		node: string,
		vmid: number,
		options?: { purge?: boolean; destroyUnreferencedDisks?: boolean }
	): Promise<string> {
		const searchParams: Record<string, string> = {};
		if (options?.purge) searchParams.purge = '1';
		if (options?.destroyUnreferencedDisks) searchParams['destroy-unreferenced-disks'] = '1';

		const res = await this.api
			.delete(`nodes/${encodeURIComponent(node)}/qemu/${vmid}`, { searchParams, timeout: 120_000 })
			.json<PveResponse<string>>();
		return res.data;
	}

	// VM power actions

	async startVm(node: string, vmid: number): Promise<string> {
		const res = await this.api
			.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`)
			.json<PveResponse<string>>();
		return res.data;
	}

	async stopVm(
		node: string,
		vmid: number,
		options?: { overruleShutdown?: boolean }
	): Promise<string> {
		const res = await this.api
			.post(
				`nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/stop`,
				options?.overruleShutdown ? { body: this.toForm({ 'overrule-shutdown': 1 }) } : undefined
			)
			.json<PveResponse<string>>();
		return res.data;
	}

	async shutdownVm(node: string, vmid: number): Promise<string> {
		const res = await this.api
			.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/shutdown`)
			.json<PveResponse<string>>();
		return res.data;
	}

	async rebootVm(node: string, vmid: number): Promise<string> {
		const res = await this.api
			.post(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/reboot`)
			.json<PveResponse<string>>();
		return res.data;
	}

	// Storage

	async listStorage(node: string): Promise<PveStorage[]> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/storage`)
			.json<PveResponse<PveStorage[]>>();
		return res.data;
	}

	async listStorageContent(
		node: string,
		storage: string,
		content?: 'iso' | 'vztmpl' | 'backup' | 'images' | 'rootdir' | 'import'
	): Promise<PveStorageContent[]> {
		const searchParams: Record<string, string> = {};
		if (content) searchParams['content'] = content;

		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`, {
				searchParams
			})
			.json<PveResponse<PveStorageContent[]>>();
		return res.data;
	}

	async importStorageContentFromUrl(
		node: string,
		storage: string,
		params: {
			url: string;
			filename: string;
			content: 'import';
			checksum?: string;
			checksumAlgorithm?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
			verifyCertificates?: boolean;
		}
	): Promise<string> {
		const payload = {
			url: params.url,
			filename: params.filename,
			content: params.content,
			checksum: params.checksum,
			'checksum-algorithm': params.checksumAlgorithm,
			'verify-certificates': params.verifyCertificates === false ? 0 : 1
		};

		try {
			const res = await this.api
				.post(
					`nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
					{
						body: this.toForm(payload),
						timeout: 120_000
					}
				)
				.json<PveResponse<string>>();
			return res.data;
		} catch (error) {
			await this.logHttpError(`importStorageContentFromUrl(${node}, ${storage})`, error, payload);
			throw error;
		}
	}

	// Tasks

	async getTaskStatus(node: string, upid: string): Promise<PveTaskStatus> {
		const res = await this.api
			.get(`nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`)
			.json<PveResponse<PveTaskStatus>>();
		return res.data;
	}

	async waitForTask(
		node: string,
		upid: string,
		opts?: { intervalMs?: number; timeoutMs?: number }
	): Promise<PveTaskStatus> {
		const interval = opts?.intervalMs ?? 1_000;
		const timeout = opts?.timeoutMs ?? 120_000;
		const deadline = Date.now() + timeout;

		while (Date.now() < deadline) {
			const status = await this.getTaskStatus(node, upid);
			if (status.status === 'stopped') {
				if (status.exitstatus && status.exitstatus !== 'OK') {
					throw new Error(`Proxmox task failed: ${status.exitstatus} (UPID: ${upid})`);
				}
				return status;
			}
			await new Promise((r) => setTimeout(r, interval));
		}

		throw new Error(`Proxmox task timed out after ${timeout}ms (UPID: ${upid})`);
	}

	// Cluster

	async getNextVmId(): Promise<number> {
		const res = await this.api.get('cluster/nextid').json<PveResponse<PveNextId>>();
		return typeof res.data === 'string' ? parseInt(res.data, 10) : res.data;
	}

	async getClusterResources(type?: 'vm' | 'storage' | 'node'): Promise<PveClusterResource[]> {
		const searchParams: Record<string, string> = {};
		if (type) searchParams['type'] = type;

		const res = await this.api
			.get('cluster/resources', { searchParams })
			.json<PveResponse<PveClusterResource[]>>();
		return res.data;
	}

	// Guest agent

	async getNetworkInterfaces(node: string, vmid: number): Promise<PveAgentNetworkInterface[]> {
    const res = await this.api
      // diable retry for fetching network interfaces
      // causes performance issues on querying VM network interfaces, ky retries 3x then gives up anyway
      // so we give up early after first attempt
			.get(`nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`, { retry: 0 })
			.json<PveResponse<{ result: PveAgentNetworkInterface[] }>>();
		return res.data.result;
	}
}
