import ky, { HTTPError } from 'ky';
import { stringify as stringifyYaml } from 'yaml';
import { Address6 } from 'ip-address';
import type { Fetcher } from '@cloudflare/workers-types';

import { config } from '$lib/server/config';
import { createVpcFetch, insecureDirectFetch } from '$lib/server/vpc';
import { instrument } from '$lib/server/observability';
import { ProxmoxClient } from './client';
import type { PveClusterResource } from './types';
import type {
	BackendImage,
	BackendImageImportTarget,
	BackendImageImportParams,
	VmBackend,
	VmInfo,
	VmCreateParams,
	VmCreateResult,
	VmStatus,
	VmMetricsHistorySample,
	VmMetricsTimeframe,
	VmLookupOptions
} from '../types';

interface ResolvedVm {
	node: string;
	vmid: number;
}

type CacheEntry<T> = {
	expiresAt: number;
	promise: Promise<T>;
};

const CLUSTER_RESOURCES_TTL_MS = 2_000;
const VM_STATUS_TTL_MS = 1_000;
const clusterResourcesCache = new Map<string, CacheEntry<PveClusterResource[]>>();
const vmStatusCache = new Map<
	string,
	CacheEntry<Awaited<ReturnType<ProxmoxClient['getQemuVm']>>>
>();

function getCached<T>(
	cache: Map<string, CacheEntry<T>>,
	key: string,
	ttlMs: number,
	load: () => Promise<T>
): Promise<T> {
	const now = Date.now();
	const existing = cache.get(key);
	if (existing && existing.expiresAt > now) return existing.promise;

	let promise: Promise<T>;
	promise = load().catch((error) => {
		if (cache.get(key)?.promise === promise) cache.delete(key);
		throw error;
	});
	cache.set(key, { expiresAt: now + ttlMs, promise });
	return promise;
}

function clearProxmoxReadCaches() {
	clusterResourcesCache.clear();
	vmStatusCache.clear();
}

type ProxmoxBackendOptions = {
	snippetsVpc?: Fetcher;
	snippetsEndpointUrl?: string;
	snippetsEndpointUsername?: string;
	snippetsEndpointPassword?: string;
	snippetsEndpointVerifySsl?: boolean;
	snippetsStorage?: string;
	firewallSecurityGroup?: string;
	vmCpuType?: string;
};

type CloudInitVendorConfigParams = {
	enableSshPasswordAuth?: boolean;
};

function generateMacAddress() {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	bytes[0] = (bytes[0] & 0xfe) | 0x02;

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function firstIpv6AddressInPrefix(prefix: string) {
	if (!Address6.isValid(prefix)) return null;

	const address = new Address6(prefix);
	return `${Address6.fromBigInt(address.startAddress().bigInt() + 1n).correctForm()}/${address.subnetMask}`;
}

function cloudInitVendorConfig(params: CloudInitVendorConfigParams) {
	const yamlContents = `#cloud-config\n${stringifyYaml({
		write_files: [
			{
				path: '/etc/sysctl.d/99-ipv6-forwarding.conf',
				content: 'net.ipv6.conf.all.forwarding = 1\n'
			},
			...((params.enableSshPasswordAuth ?? false)
				? [
						{
							path: '/etc/ssh/sshd_config.d/50-enable-root-login.conf',
							content: 'PermitRootLogin yes\n'
						}
					]
				: [])
		],
		runcmd: [
			'sysctl --system',
			...((params.enableSshPasswordAuth ?? false)
				? ['systemctl restart ssh', 'systemctl restart sshd']
				: [])
		],
		ssh_pwauth: params.enableSshPasswordAuth ?? false
	})}`;

	return yamlContents;
}

function uniqueFirewallIpSetEntries(params: VmCreateParams) {
	return [...new Set(params.networkConfig?.firewallIpSet ?? [])];
}

function cloudInitNetworkConfig(params: VmCreateParams, macAddress: string) {
	const delegatedPrefixAddress = params.networkConfig?.ipv6Prefix
		? firstIpv6AddressInPrefix(params.networkConfig.ipv6Prefix)
		: null;
	const addresses = [
		...(params.networkConfig?.ipv4 ? [`${params.networkConfig.ipv4.address}/32`] : []),
		...(params.networkConfig?.ipv6 ? [`${params.networkConfig.ipv6.address}/128`] : []),
		...(delegatedPrefixAddress ? [delegatedPrefixAddress] : [])
	];
	const routes = [
		...(params.networkConfig?.ipv4
			? [
					{ to: `${params.networkConfig.ipv4.gateway}/32`, scope: 'link' },
					{ to: '0.0.0.0/0', via: params.networkConfig.ipv4.gateway, 'on-link': true }
				]
			: []),
		...(params.networkConfig?.ipv6
			? [{ to: '::/0', via: config.vmNetwork.ipv6DefaultGateway, 'on-link': true }]
			: [])
	];

	const yamlContents = stringifyYaml({
		version: 2,
		ethernets: {
			public0: {
				match: { macaddress: macAddress.toLowerCase() },
				'set-name': 'eth0',
				dhcp4: false,
				dhcp6: false,
				addresses,
				routes,
				nameservers: { addresses: config.vmNetwork.nameservers }
			}
		}
	});

	return yamlContents;
}

export class ProxmoxBackend implements VmBackend {
	readonly name = 'proxmox' as const;
	private client: ProxmoxClient;
	private options: ProxmoxBackendOptions;

	constructor(client: ProxmoxClient, options: ProxmoxBackendOptions = {}) {
		this.client = client;
		this.options = options;
	}

	private mapStatus(status: string): VmStatus {
		switch (status) {
			case 'running':
				return 'running';
			case 'stopped':
				return 'stopped';
			case 'paused':
				return 'paused';
			default:
				return 'unknown';
		}
	}

	private async resolve(id: string, proxmoxId?: number): Promise<ResolvedVm> {
		const resources = await instrument(
			'proxmox.resolveVm.clusterResources',
			() => this.getClusterResources('vm'),
			{ 'vm.proxmox_id': proxmoxId ?? undefined }
		);
		const match = resources.find(
			(r) => r.type === 'qemu' && (proxmoxId != null ? r.vmid === proxmoxId : r.name === id)
		);

		if (!match || !match.node || match.vmid == null) {
			throw new Error(
				proxmoxId != null
					? `VM with Proxmox ID "${proxmoxId}" not found on any Proxmox node`
					: `VM "${id}" not found on any Proxmox node`
			);
		}

		return { node: match.node, vmid: match.vmid };
	}

	private resolveFromHint(
		proxmoxId: number | undefined,
		proxmoxNode: string | undefined
	): ResolvedVm | null {
		if (proxmoxNode && proxmoxId != null) return { node: proxmoxNode, vmid: proxmoxId };
		return null;
	}

	private async getClusterResources(type?: 'vm' | 'storage' | 'node') {
		return getCached(clusterResourcesCache, type ?? 'all', CLUSTER_RESOURCES_TTL_MS, () =>
			this.client.getClusterResources(type)
		);
	}

	private async getCachedQemuVm(node: string, vmid: number) {
		return getCached(vmStatusCache, `${node}:${vmid}`, VM_STATUS_TTL_MS, () =>
			this.client.getQemuVm(node, vmid)
		);
	}

	private resourceToInfo(r: PveClusterResource): VmInfo {
		const memoryUsage = r.mem != null && r.maxmem ? r.mem / r.maxmem : undefined;
		const diskUsage = r.disk != null && r.maxdisk ? r.disk / r.maxdisk : undefined;

		return {
			id: r.name ?? String(r.vmid),
			proxmoxId: r.vmid,
			proxmoxNode: r.node,
			name: r.name ?? `VM ${r.vmid}`,
			status: this.mapStatus(r.status ?? 'unknown'),
			cores: r.maxcpu ?? 0,
			memory: r.maxmem ?? 0,
			disk: r.maxdisk ?? 0,
			uptime: r.uptime ?? 0,
			metrics: {
				cpu: r.cpu,
				memory: memoryUsage,
				disk: diskUsage
			}
		};
	}

	private storageSupportsContent(content: string | undefined, target: string): boolean {
		return (content ?? '')
			.split(',')
			.map((value) => value.trim())
			.includes(target);
	}

	private isActiveImportStorage(storage: { content?: string; active?: 0 | 1; enabled?: 0 | 1 }) {
		return (
			this.storageSupportsContent(storage.content, 'import') &&
			storage.active !== 0 &&
			storage.enabled !== 0
		);
	}

	private async snippetStorage(node: string) {
		if (this.options.snippetsStorage) return this.options.snippetsStorage;

		const storages = await this.client.listStorage(node);
		const storage = storages.find(
			(storage) =>
				this.storageSupportsContent(storage.content, 'snippets') &&
				storage.active !== 0 &&
				storage.enabled !== 0
		);

		if (!storage) {
			throw new Error(
				`No active Proxmox storage on node "${node}" supports snippets. Set PROXMOX_SNIPPETS_STORAGE to the storage id used by pvecic-snippets-endpoint.`
			);
		}

		return storage.storage;
	}

	private async uploadSnippet(filename: string, content: string) {
		const endpointUrl = this.options.snippetsEndpointUrl?.replace(/\/+$/, '');
		const username = this.options.snippetsEndpointUsername;
		const password = this.options.snippetsEndpointPassword;

		if (!endpointUrl || !username || !password) {
			throw new Error(
				'Custom cloud-init networking requires PROXMOX_SNIPPETS_ENDPOINT_URL, PROXMOX_SNIPPETS_ENDPOINT_USERNAME, and PROXMOX_SNIPPETS_ENDPOINT_PASSWORD'
			);
		}

		const directFetch =
			this.options.snippetsEndpointVerifySsl === false ? insecureDirectFetch : globalThis.fetch;
		const snippetFetch = createVpcFetch(
			this.options.snippetsVpc ? [this.options.snippetsVpc] : [],
			directFetch
		);

		try {
			await ky.put(`${endpointUrl}/${encodeURIComponent(filename)}`, {
				headers: {
					Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
					'Content-Type': 'text/cloud-config'
				},
				body: content,
				timeout: 60_000,
				fetch: snippetFetch
			});
		} catch (err) {
			if (err instanceof HTTPError) {
				const body = await err.response.text().catch(() => '<unreadable response body>');
				throw new Error(
					`Snippet endpoint upload failed for ${filename}: ${err.response.status} ${err.response.statusText} - ${body}`
				);
			}

			const cause = err instanceof Error && err.cause ? `: ${String(err.cause)}` : '';
			throw new Error(`Snippet endpoint upload failed for ${filename}: ${String(err)}${cause}`);
		}
	}

	async listVms(): Promise<VmInfo[]> {
		const resources = await instrument('proxmox.listVms.clusterResources', () =>
			this.getClusterResources('vm')
		);
		return resources.filter((r) => r.type === 'qemu').map((r) => this.resourceToInfo(r));
	}

	private async firstOnlineNode() {
		const nodes = await this.client.listNodes();
		const online = nodes.filter((node) => node.status === 'online');
		if (online.length === 0) throw new Error('No online Proxmox nodes available');
		return online.sort((a, b) => a.node.localeCompare(b.node))[0];
	}

	async listImages(): Promise<BackendImage[]> {
		const node = await this.firstOnlineNode();
		const storages = await this.client.listStorage(node.node);
		const importStorages = storages.filter((storage) => this.isActiveImportStorage(storage));

		const storageImages = await Promise.all(
			importStorages.map(async (storage) => {
				const contents = await this.client.listStorageContent(node.node, storage.storage, 'import');

				return contents.map((item) => {
					const parts = item.volid.split('/');
					return {
						volid: item.volid,
						filename: parts.at(-1) ?? item.volid,
						size: item.size,
						node: node.node,
						storage: storage.storage,
						content: 'import' as const,
						format: item.format
					};
				});
			})
		);

		return storageImages.flat();
	}

	async listImageImportTargets(): Promise<BackendImageImportTarget[]> {
		const node = await this.firstOnlineNode();
		const storages = await this.client.listStorage(node.node);
		return storages
			.filter((storage) => this.isActiveImportStorage(storage))
			.map((storage) => ({ node: node.node, storage: storage.storage }));
	}

	async importImageFromUrl(params: BackendImageImportParams): Promise<string> {
		return this.client.importStorageContentFromUrl(params.node, params.storage, {
			url: params.url,
			filename: params.filename,
			content: 'import',
			checksum: params.checksum,
			checksumAlgorithm: params.checksumAlgorithm,
			verifyCertificates: params.verifyCertificates
		});
	}

	async getTaskStatus(node: string, upid: string) {
		const status = await this.client.getTaskStatus(node, upid);
		return { status: status.status, exitstatus: status.exitstatus };
	}

	async getVm(id: string, proxmoxId?: number, options: VmLookupOptions = {}): Promise<VmInfo> {
		let { node, vmid } =
			this.resolveFromHint(proxmoxId, options.proxmoxNode) ?? (await this.resolve(id, proxmoxId));
		const status = await instrument(
			'proxmox.getVm.status',
			async () => {
				try {
					return await this.getCachedQemuVm(node, vmid);
				} catch (error) {
					if (!options.proxmoxNode || proxmoxId == null) throw error;
					const resolved = await this.resolve(id, proxmoxId);
					node = resolved.node;
					vmid = resolved.vmid;
					return await this.getCachedQemuVm(node, vmid);
				}
			},
			{
				'proxmox.node': node,
				'proxmox.vmid': vmid,
				'proxmox.node_hint': options.proxmoxNode ?? undefined
			}
		);

		let networkInterfaces: VmInfo['networkInterfaces'] | undefined;
		if (options.includeNetworkInterfaces !== false && status.status === 'running') {
			try {
				networkInterfaces = await this.getVmNetworkInterfaces(id, proxmoxId, { proxmoxNode: node });
			} catch {
				// guest agent may not be installed
			}
		}

		const memoryUsage =
			status.mem != null && status.maxmem ? status.mem / status.maxmem : undefined;
		const diskUsage =
			status.disk != null && status.maxdisk ? status.disk / status.maxdisk : undefined;

		return {
			id,
			proxmoxId: vmid,
			proxmoxNode: node,
			name: status.name ?? `VM ${status.vmid}`,
			status: this.mapStatus(status.status),
			cores: status.cpus ?? 0,
			memory: status.maxmem ?? 0,
			disk: status.maxdisk ?? 0,
			uptime: status.uptime ?? 0,
			networkInterfaces,
			metrics: {
				cpu: status.cpu,
				memory: memoryUsage,
				disk: diskUsage,
				networkIn: status.netin,
				networkOut: status.netout,
				diskRead: status.diskread,
				diskWrite: status.diskwrite
			}
		};
	}

	async getVmNetworkInterfaces(
		id: string,
		proxmoxId?: number,
		options: Pick<VmLookupOptions, 'proxmoxNode'> = {}
	): Promise<VmInfo['networkInterfaces']> {
		const { node, vmid } =
			this.resolveFromHint(proxmoxId, options.proxmoxNode) ?? (await this.resolve(id, proxmoxId));
		const ifaces = await instrument(
			'proxmox.getVm.agentNetworkInterfaces',
			() => this.client.getNetworkInterfaces(node, vmid),
			{ 'proxmox.node': node, 'proxmox.vmid': vmid }
		);
		const networkInterfaces: VmInfo['networkInterfaces'] = {};
		for (const iface of ifaces) {
			networkInterfaces[iface.name] = {
				ipAddresses: iface['ip-addresses']?.map((a) => a['ip-address'])
			};
		}
		return networkInterfaces;
	}

	async getVmMetricsHistory(
		id: string,
		proxmoxId: number | undefined,
		timeframe: VmMetricsTimeframe,
		options: Pick<VmLookupOptions, 'proxmoxNode'> = {}
	): Promise<VmMetricsHistorySample[]> {
		const { node, vmid } =
			this.resolveFromHint(proxmoxId, options.proxmoxNode) ?? (await this.resolve(id, proxmoxId));
		const samples = await instrument(
			'proxmox.getVmMetricsHistory.rrdData',
			() => this.client.getQemuRrdData(node, vmid, { timeframe }),
			{ 'proxmox.node': node, 'proxmox.vmid': vmid, 'vm.metrics.timeframe': timeframe }
		);

		return samples.map((sample) => ({
			time: sample.time,
			cpu: sample.cpu ?? null,
			memory: sample.mem != null && sample.maxmem ? sample.mem / sample.maxmem : null,
			bandwidth:
				sample.netin == null && sample.netout == null
					? null
					: (sample.netin ?? 0) + (sample.netout ?? 0),
			diskIo:
				sample.diskread == null && sample.diskwrite == null
					? null
					: (sample.diskread ?? 0) + (sample.diskwrite ?? 0)
		}));
	}

	async createVm(params: VmCreateParams): Promise<VmCreateResult> {
		clearProxmoxReadCaches();
		const [nodes, vmid] = await Promise.all([this.client.listNodes(), this.client.getNextVmId()]);

		// Pick the online node with the most free memory
		const online = nodes.filter((n) => n.status === 'online');
		if (!online.length) throw new Error('No online Proxmox nodes available');
		const node = online.sort((a, b) => b.maxmem - b.mem - (a.maxmem - a.mem))[0];

		const sshKeysEncoded = params.sshKeys
			? encodeURIComponent(params.sshKeys.join('\n'))
			: undefined;
		const cloudInitAuth =
			sshKeysEncoded || params.password
				? {
						ciuser: 'root',
						...(sshKeysEncoded ? { sshkeys: sshKeysEncoded } : {}),
						...(params.password ? { cipassword: params.password } : {})
					}
				: {};
		const bootDisk = 'virtio0';
		const pvePool = config.proxmox.vmDiskStorage;
		const macAddress = params.macAddress ?? generateMacAddress();
		const cloudInitNetworkConfigFilename = `stack-${vmid}-network.yaml`;
		const cloudInitVendorConfigFilename = `stack-${vmid}-vendor.yaml`;
		const cloudInitSnippetStorage = await this.snippetStorage(node.node);
		const cloudInitNetworkConfigVolid = `${cloudInitSnippetStorage}:snippets/${cloudInitNetworkConfigFilename}`;
		const cloudInitVendorConfigVolid = `${cloudInitSnippetStorage}:snippets/${cloudInitVendorConfigFilename}`;
		await Promise.all([
			this.uploadSnippet(
				cloudInitNetworkConfigFilename,
				cloudInitNetworkConfig(params, macAddress)
			),
			this.uploadSnippet(
				cloudInitVendorConfigFilename,
				cloudInitVendorConfig({ enableSshPasswordAuth: Boolean(params.password) })
			)
		]);

		const firewallIpSetEntries = uniqueFirewallIpSetEntries(params);

		await this.client.createQemuVm(node.node, {
			vmid,
			name: params.name,
			cores: params.cores,
			sockets: 1,
			memory: params.memoryMb,
			cpu: this.options.vmCpuType ?? 'x86-64-v4',
			ostype: 'l26',
			bios: 'ovmf',
			machine: 'q35',
			efidisk0: `${pvePool}:0,efitype=4m,pre-enrolled-keys=1`,
			tpmstate0: `${pvePool}:0,version=v2.0`,
			scsihw: 'virtio-scsi-single',
			...(params.imageSource ? {} : { virtio0: `${pvePool}:${params.diskGb}` }),
			ide2: `${pvePool}:cloudinit`,
			net0: `virtio=${macAddress},bridge=${config.proxmox.vmBridge},firewall=1,rate=${config.proxmox.vmNetRateMbps}`,
			pool: config.proxmox.tenantPool,
			boot: `order=${bootDisk}`,
			cicustom: `network=${cloudInitNetworkConfigVolid},vendor=${cloudInitVendorConfigVolid}`,
			ciupgrade: 0,
			...cloudInitAuth,
			serial0: 'socket',
			agent: '1',
			tags: `vmid-${params.id};projectid-${params.projectId};userid-${params.userId}`,
			'ha-managed': 1
		});

		await this.client.updateQemuFirewallOptions(node.node, vmid, {
			enable: 1,
			policy_in: 'ACCEPT',
			policy_out: 'ACCEPT',
			ipfilter: 1,
			macfilter: 1,
			ndp: 1,
			dhcp: 0
		});
		if (this.options.firewallSecurityGroup) {
			await this.client.addQemuFirewallSecurityGroupRule(
				node.node,
				vmid,
				this.options.firewallSecurityGroup
			);
		}
		if (firewallIpSetEntries.length > 0) {
			const ipsetName = 'ipfilter-net0';
			await this.client.createQemuFirewallIpset(node.node, vmid, ipsetName);
			await Promise.all(
				firewallIpSetEntries.map((cidr) =>
					this.client.addQemuFirewallIpsetEntry(node.node, vmid, ipsetName, cidr, 'stack-ipam')
				)
			);
		}

		if (params.imageSource) {
			const importUpid = await this.client.updateQemuConfigAsync(node.node, vmid, {
				virtio0: `${pvePool}:0,import-from=${params.imageSource}`
			});

			const provisioning = this.client
				.waitForTask(node.node, importUpid)
				.then(async () => {
					if (params.diskGb > 0) {
						await this.client.resizeDisk(node.node, vmid, 'virtio0', `${params.diskGb}G`);
					}
					const startUpid = await this.client.startVm(node.node, vmid);
					await this.client.waitForTask(node.node, startUpid);
					await params.onProvisionSettled?.({ ok: true });
				})
				.catch(async (err) => {
					console.error(`VM ${params.id} image import failed:`, err);
					await params.onProvisionSettled?.({
						ok: false,
						error: err instanceof Error ? err.message : String(err)
					});
				});

			if (params.registerBackground) {
				params.registerBackground(provisioning, `vm-provision-${params.id}`);
			} else {
				await provisioning;
			}
		} else {
			const startUpid = await this.client.startVm(node.node, vmid);
			await this.client.waitForTask(node.node, startUpid);
			await params.onProvisionSettled?.({ ok: true });
		}

		clearProxmoxReadCaches();
		return {
			id: params.id,
			proxmoxId: vmid,
			proxmoxNode: node.node,
			macAddress,
			taskId: String(vmid)
		};
	}

	async deleteVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		let resolved: ResolvedVm;
		try {
			resolved = await this.resolve(id, proxmoxId);
		} catch (err) {
			if (err instanceof Error && err.message.includes('not found on any Proxmox node')) return;
			throw err;
		}

		const { node, vmid } = resolved;

		try {
			await this.ensureVmStopped(node, vmid);
		} catch (err) {
			if (err instanceof HTTPError && err.response.status === 404) return;
			throw err;
		}

		const upid = await this.destroyVm(node, vmid);
		if (!upid) return;

		await this.client.waitForTask(node, upid);
	}

	private async ensureVmStopped(node: string, vmid: number): Promise<void> {
		const status = await this.client.getQemuVm(node, vmid);
		if (status.status === 'stopped') return;

		let stopUpid: string;
		try {
			stopUpid = await this.client.stopVm(node, vmid, { overruleShutdown: true });
		} catch (err) {
			if (!(err instanceof HTTPError) || err.response.status !== 400) throw err;
			stopUpid = await this.client.stopVm(node, vmid);
		}
		try {
			await this.client.waitForTask(node, stopUpid);
		} catch (err) {
			const current = await this.client.getQemuVm(node, vmid);
			if (current.status !== 'stopped') throw err;
		}

		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			const current = await this.client.getQemuVm(node, vmid);
			if (current.status === 'stopped') return;
			await new Promise((r) => setTimeout(r, 1_000));
		}
		throw new Error(`VM ${vmid} on node ${node} did not reach stopped state within 60s`);
	}

	private async destroyVm(node: string, vmid: number): Promise<string | undefined> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.client.deleteQemuVm(node, vmid, {
					purge: true,
					destroyUnreferencedDisks: true
				});
			} catch (err) {
				if (err instanceof HTTPError && err.response.status === 404) return undefined;
				if (!(err instanceof HTTPError) || attempt >= 3) throw err;
				await new Promise((r) => setTimeout(r, 2_000));
				await this.ensureVmStopped(node, vmid);
			}
		}
	}

	async startVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async stopVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.shutdownVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async killVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.stopVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async rebootVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.rebootVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}
}
