import ky, { HTTPError } from 'ky';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
	VmLookupOptions,
	VmResizeParams
} from '../types';
import { VmNotFoundError, VmResizeError } from '../types';

interface ResolvedVm {
	node: string;
	vmid: number;
}

const STABLE_ID_TAG_PREFIX = 'vmid-';

function stableIdTag(id: string) {
	return `${STABLE_ID_TAG_PREFIX}${id.toLowerCase()}`;
}

function stableIdFromTags(tags: string | undefined): string | undefined {
	if (!tags) return undefined;
	const tag = tags
		.split(/[;,]/)
		.map((entry) => entry.trim().toLowerCase())
		.find((entry) => entry.startsWith(STABLE_ID_TAG_PREFIX));
	return tag ? tag.slice(STABLE_ID_TAG_PREFIX.length) : undefined;
}

type CacheEntry<T> = {
	expiresAt: number;
	promise: Promise<T>;
};

const CLUSTER_RESOURCES_TTL_MS = 2_000;
const VM_STATUS_TTL_MS = 1_000;
const RUNNING_CONFIRMATION_TIMEOUT_MS = 30_000;
const RUNNING_CONFIRMATION_INTERVAL_MS = 1_000;
const clusterResourcesCache = new Map<string, CacheEntry<PveClusterResource[]>>();
const vmStatusCache = new Map<
	string,
	CacheEntry<Awaited<ReturnType<ProxmoxClient['getQemuVm']>>>
>();
const vmConfigCache = new Map<
	string,
	CacheEntry<Awaited<ReturnType<ProxmoxClient['getQemuConfig']>>>
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
	vmConfigCache.clear();
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
	excludedNodes?: string[];
};

const UNSCHEDULABLE_HA_STATES = new Set(['maintenance', 'fence', 'gone']);

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
		ssh_deletekeys: false,
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
			'sh -c "sysctl -p /etc/sysctl.d/99-ipv6-forwarding.conf || sysctl -w net.ipv6.conf.all.forwarding=1"',
			...((params.enableSshPasswordAuth ?? false)
				? ['sh -c "rc-service sshd restart || systemctl restart sshd || systemctl restart ssh"']
				: [])
		],
		ssh_pwauth: params.enableSshPasswordAuth ?? false
	})}`;

	return yamlContents;
}

function withSshHostKeysPreserved(vendorConfig: string) {
	const config: unknown = parseYaml(vendorConfig);
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('Dashboard-managed cloud-init vendor data is not a YAML object');
	}

	return `#cloud-config\n${stringifyYaml({ ...config, ssh_deletekeys: false })}`;
}

function uniqueFirewallIpSetEntries(params: VmCreateParams) {
	return [...new Set(params.networkConfig?.firewallIpSet ?? [])];
}

function cloudInitNetworkConfig(params: VmCreateParams, macAddress: string) {
	const delegatedPrefixAddress = params.networkConfig?.ipv6Prefix
		? firstIpv6AddressInPrefix(params.networkConfig.ipv6Prefix)
		: null;
	const addresses = [
		...(params.networkConfig?.ipv4
			? [`${params.networkConfig.ipv4.address}/${params.networkConfig.ipv4.prefixLength}`]
			: []),
		...(params.networkConfig?.ipv6
			? [`${params.networkConfig.ipv6.address}/${params.networkConfig.ipv6.prefixLength}`]
			: []),
		...(delegatedPrefixAddress ? [delegatedPrefixAddress] : [])
	];
	const routes = [
		...(params.networkConfig?.ipv4?.gateway
			? [{ to: '0.0.0.0/0', via: params.networkConfig.ipv4.gateway, 'on-link': true }]
			: []),
		...(params.networkConfig?.ipv6
			? [
					{ to: '::/0', via: config.vmNetwork.ipv6DefaultGateway, 'on-link': true },
					...(params.networkConfig.nat64Prefix
						? [
								{
									to: params.networkConfig.nat64Prefix,
									via: config.vmNetwork.ipv6DefaultGateway,
									'on-link': true
								}
							]
						: [])
				]
			: [])
	];

	const nat64Dns64Server = params.networkConfig?.nat64Dns64Server;
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
				nameservers: {
					addresses: nat64Dns64Server
						? [nat64Dns64Server, ...config.vmNetwork.nameservers]
						: config.vmNetwork.nameservers
				}
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

	private async isOwnedBy(id: string, candidate: ResolvedVm): Promise<boolean> {
		const config = await this.getCachedQemuConfig(candidate.node, candidate.vmid);
		const claimed = stableIdFromTags(typeof config.tags === 'string' ? config.tags : undefined);
		return claimed === id.toLowerCase();
	}

	private async resolveFromHint(
		id: string,
		proxmoxId?: number,
		proxmoxNode?: string
	): Promise<ResolvedVm | null> {
		if (!proxmoxNode || proxmoxId == null) return null;
		const candidate = { node: proxmoxNode, vmid: proxmoxId };
		try {
			return (await this.isOwnedBy(id, candidate)) ? candidate : null;
		} catch {
			return null;
		}
	}

	private async resolveForRead(
		id: string,
		proxmoxId?: number,
		proxmoxNode?: string
	): Promise<ResolvedVm> {
		return (
			(await this.resolveFromHint(id, proxmoxId, proxmoxNode)) ??
			this.resolveVerified(id, proxmoxId)
		);
	}

	private async resolveForMutation(id: string, proxmoxId?: number): Promise<ResolvedVm> {
		return this.resolveVerified(id, proxmoxId);
	}

	private async resolveVerified(id: string, proxmoxId?: number): Promise<ResolvedVm> {
		const resolved = await this.resolve(id, proxmoxId);
		vmConfigCache.delete(`${resolved.node}:${resolved.vmid}`);
		if (!(await this.isOwnedBy(id, resolved))) {
			throw new VmNotFoundError(
				`VM ${resolved.vmid} on ${resolved.node} is not tagged as VM "${id}"`
			);
		}
		return resolved;
	}

	private async resolve(id: string, proxmoxId?: number): Promise<ResolvedVm> {
		const resources = await instrument(
			'proxmox.resolveVm.clusterResources',
			() => this.getClusterResources('vm'),
			{ 'vm.id': id, 'vm.proxmox_id': proxmoxId ?? undefined }
		);
		const expectedStableId = id.toLowerCase();
		const match = resources.find(
			(r) => r.type === 'qemu' && stableIdFromTags(r.tags) === expectedStableId
		);

		if (!match || !match.node || match.vmid == null) {
			throw new VmNotFoundError(`VM "${id}" not found on any Proxmox node`);
		}

		return { node: match.node, vmid: match.vmid };
	}

	private async getClusterResources(type?: 'vm' | 'storage' | 'node') {
		return getCached(clusterResourcesCache, type ?? 'all', CLUSTER_RESOURCES_TTL_MS, () =>
			this.client.getClusterResources(type)
		);
	}

	private async startAndAwaitRunning(node: string, vmid: number) {
		const startUpid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, startUpid);
		const deadline = Date.now() + RUNNING_CONFIRMATION_TIMEOUT_MS;
		while (Date.now() < deadline) {
			const resources = await this.client.getClusterResources('vm');
			const current = resources.find((resource) => resource.vmid === vmid);
			if (current?.status === 'running') break;
			await new Promise((resolve) => setTimeout(resolve, RUNNING_CONFIRMATION_INTERVAL_MS));
		}
		clearProxmoxReadCaches();
	}

	async finishProvisioning(
		id: string,
		proxmoxId: number | undefined,
		params: { diskGb: number },
		options: Pick<VmLookupOptions, 'proxmoxNode'> = {}
	): Promise<boolean> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const config = await this.client.getQemuConfig(node, vmid);
		const currentDiskGb = parseDiskSizeGb(config.virtio0);
		if (config.lock || currentDiskGb == null) return false;

		if (params.diskGb > currentDiskGb) {
			await this.client.resizeDisk(node, vmid, 'virtio0', `${params.diskGb}G`);
		}
		const current = await this.client.getQemuVm(node, vmid);
		if (current.status !== 'running') {
			await this.startAndAwaitRunning(node, vmid);
		}
		clearProxmoxReadCaches();
		return true;
	}

	private async getCachedQemuVm(node: string, vmid: number) {
		return getCached(vmStatusCache, `${node}:${vmid}`, VM_STATUS_TTL_MS, () =>
			this.client.getQemuVm(node, vmid)
		);
	}

	private async getCachedQemuConfig(node: string, vmid: number) {
		return getCached(vmConfigCache, `${node}:${vmid}`, CLUSTER_RESOURCES_TTL_MS, () =>
			this.client.getQemuConfig(node, vmid)
		);
	}

	async ping(): Promise<void> {
		await this.client.listNodes();
	}

	private resourceToInfo(r: PveClusterResource): VmInfo {
		const memoryUsage = r.mem != null && r.maxmem ? r.mem / r.maxmem : undefined;
		const diskUsage = r.disk != null && r.maxdisk ? r.disk / r.maxdisk : undefined;

		const stableId = stableIdFromTags(r.tags);
		return {
			id: stableId ?? r.name ?? String(r.vmid),
			stableId,
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
				'Custom cloud-init snippets require PROXMOX_SNIPPETS_ENDPOINT_URL, PROXMOX_SNIPPETS_ENDPOINT_USERNAME, and PROXMOX_SNIPPETS_ENDPOINT_PASSWORD'
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

	private async readSnippet(filename: string) {
		const endpointUrl = this.options.snippetsEndpointUrl?.replace(/\/+$/, '');
		const username = this.options.snippetsEndpointUsername;
		const password = this.options.snippetsEndpointPassword;

		if (!endpointUrl || !username || !password) {
			throw new Error(
				'Custom cloud-init snippets require PROXMOX_SNIPPETS_ENDPOINT_URL, PROXMOX_SNIPPETS_ENDPOINT_USERNAME, and PROXMOX_SNIPPETS_ENDPOINT_PASSWORD'
			);
		}

		const directFetch =
			this.options.snippetsEndpointVerifySsl === false ? insecureDirectFetch : globalThis.fetch;
		const snippetFetch = createVpcFetch(
			this.options.snippetsVpc ? [this.options.snippetsVpc] : [],
			directFetch
		);

		try {
			return await ky
				.get(`${endpointUrl}/${encodeURIComponent(filename)}`, {
					headers: {
						Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
					},
					timeout: 60_000,
					fetch: snippetFetch
				})
				.text();
		} catch (err) {
			if (err instanceof HTTPError) {
				const body = await err.response.text().catch(() => '<unreadable response body>');
				throw new Error(
					`Snippet endpoint read failed for ${filename}: ${err.response.status} ${err.response.statusText} - ${body}`
				);
			}

			const cause = err instanceof Error && err.cause ? `: ${String(err.cause)}` : '';
			throw new Error(`Snippet endpoint read failed for ${filename}: ${String(err)}${cause}`);
		}
	}

	async listVms(): Promise<VmInfo[]> {
		const resources = await instrument('proxmox.listVms.clusterResources', () =>
			this.getClusterResources('vm')
		);
		return resources.filter((r) => r.type === 'qemu').map((r) => this.resourceToInfo(r));
	}

	async listUsedProxmoxIds(): Promise<Set<number>> {
		clearProxmoxReadCaches();
		const resources = await this.client.getClusterResources('vm');
		return new Set(resources.flatMap((r) => (r.vmid != null ? [r.vmid] : [])));
	}

	private async listSchedulableNodes() {
		const [nodes, resources] = await Promise.all([
			this.client.listNodes(),
			this.getClusterResources('node')
		]);
		const haStateByNode = new Map(resources.map((r) => [r.node, r.hastate]));
		const excluded = new Set(this.options.excludedNodes ?? []);
		const schedulable = nodes.filter((node) => {
			if (node.status !== 'online') return false;
			if (excluded.has(node.node)) return false;
			const haState = haStateByNode.get(node.node);
			return !haState || !UNSCHEDULABLE_HA_STATES.has(haState);
		});
		if (schedulable.length === 0) {
			throw new Error(
				'No schedulable Proxmox nodes available (all offline, excluded, or in maintenance)'
			);
		}
		return schedulable;
	}

	private async firstSchedulableNode() {
		const nodes = await this.listSchedulableNodes();
		return nodes.sort((a, b) => a.node.localeCompare(b.node))[0];
	}

	async listImages(): Promise<BackendImage[]> {
		const node = await this.firstSchedulableNode();
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
		const node = await this.firstSchedulableNode();
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
		const { node, vmid } = await this.resolveForRead(id, proxmoxId, options.proxmoxNode);
		const status = await instrument(
			'proxmox.getVm.status',
			() => this.getCachedQemuVm(node, vmid),
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
			stableId: id.toLowerCase(),
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
		const { node, vmid } = await this.resolveForRead(id, proxmoxId, options.proxmoxNode);
		const ifaces = await instrument(
			'proxmox.getVm.agentNetworkInterfaces',
			() => this.client.getNetworkInterfaces(node, vmid),
			{ 'proxmox.node': node, 'proxmox.vmid': vmid }
		);
		const networkInterfaces: VmInfo['networkInterfaces'] = Object.fromEntries(
			ifaces.map((iface) => [
				iface.name,
				{ ipAddresses: iface['ip-addresses']?.map((a) => a['ip-address']) }
			])
		);
		return networkInterfaces;
	}

	async getVmMetricsHistory(
		id: string,
		proxmoxId: number | undefined,
		timeframe: VmMetricsTimeframe,
		options: Pick<VmLookupOptions, 'proxmoxNode'> = {}
	): Promise<VmMetricsHistorySample[]> {
		const { node, vmid } = await this.resolveForRead(id, proxmoxId, options.proxmoxNode);
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
		const vmid = params.proxmoxId;
		const nodes = await this.listSchedulableNodes();
		const node = nodes.sort((a, b) => b.maxmem - b.mem - (a.maxmem - a.mem))[0];

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

		const createUpid = await this.client.createQemuVm(node.node, {
			vmid,
			name: params.name,
			cores: params.cores,
			sockets: 1,
			memory: params.memoryMb,
			cpu: this.options.vmCpuType ?? 'x86-64-v4',
			ostype: 'l26',
			bios: 'ovmf',
			machine: 'q35',
			efidisk0: `${pvePool}:0,efitype=4m,pre-enrolled-keys=${(params.secureBoot ?? true) ? 1 : 0}`,
			tpmstate0: `${pvePool}:0,version=v2.0`,
			scsihw: 'virtio-scsi-single',
			...(params.imageSource
				? {}
				: { virtio0: `${pvePool}:${params.diskGb},cache=writeback,iothread=1` }),
			ide2: `${pvePool}:cloudinit`,
			net0: `virtio=${macAddress},bridge=${config.proxmox.vmBridge},firewall=1,rate=${config.proxmox.vmNetRateMbps}`,
			pool: config.proxmox.tenantPool,
			boot: `order=${bootDisk}`,
			cicustom: `network=${cloudInitNetworkConfigVolid},vendor=${cloudInitVendorConfigVolid}`,
			ciupgrade: 0,
			...cloudInitAuth,
			serial0: 'socket',
			agent: '1',
			tags: `${stableIdTag(params.id)};projectid-${params.projectId};userid-${params.userId}`,
			'ha-managed': 1
		});
		await this.client.waitForTask(node.node, createUpid);

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
				virtio0: `${pvePool}:0,import-from=${params.imageSource},cache=writeback,iothread=1`
			});

			const provisioning = this.client
				.waitForTask(node.node, importUpid)
				.then(async () => {
					if (params.diskGb > 0) {
						await this.client.resizeDisk(node.node, vmid, 'virtio0', `${params.diskGb}G`);
					}
					await this.startAndAwaitRunning(node.node, vmid);
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
			await this.startAndAwaitRunning(node.node, vmid);
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

	async updateVmHostname(id: string, hostname: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const storage = await this.snippetStorage(node);
		const currentConfig = await this.client.getQemuConfig(node, vmid);
		const customConfigs = (currentConfig.cicustom ?? '')
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
		if (customConfigs.some((entry) => entry.startsWith('user='))) {
			throw new Error('Cannot update hostname while the VM uses custom cloud-init user data');
		}

		const vendorFilename = `stack-${vmid}-vendor.yaml`;
		if (!customConfigs.includes(`vendor=${storage}:snippets/${vendorFilename}`)) {
			throw new Error(
				'Cannot update hostname without the dashboard-managed cloud-init vendor data'
			);
		}

		const vendorConfig = await this.readSnippet(vendorFilename);
		await this.uploadSnippet(vendorFilename, withSshHostKeysPreserved(vendorConfig));

		const upid = await this.client.updateQemuConfigAsync(node, vmid, { name: hostname });
		await this.client.waitForTask(node, upid);
		await this.client.regenerateCloudInit(node, vmid);
	}

	async deleteVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		let resolved: ResolvedVm;
		try {
			resolved = await this.resolveForMutation(id, proxmoxId);
		} catch (err) {
			if (err instanceof VmNotFoundError) return;
			throw err;
		}

		const { node, vmid } = resolved;

		try {
			await this.ensureVmStopped(node, vmid);
		} catch (err) {
			if (err instanceof HTTPError && err.response.status === 404) return;
			throw err;
		}

		await this.destroyVmAndWait(node, vmid);
	}

	private async destroyVmAndWait(node: string, vmid: number): Promise<void> {
		await new Promise((r) => setTimeout(r, 3_000));
		const upid = await this.destroyVm(node, vmid);
		if (!upid) return;
		const status = await this.client.waitForTask(node, upid);
		const leaked = await this.leakedDisksAfterDestroy(node, upid, status.exitstatus);
		if (leaked.length > 0) await this.retryLeakedDiskRemoval(node, vmid, leaked);
	}

	private async leakedDisksAfterDestroy(
		node: string,
		upid: string,
		exitstatus?: string
	): Promise<string[]> {
		if (!exitstatus?.startsWith('WARNINGS:')) return [];
		const lines = await this.client.getTaskLog(node, upid);
		return lines
			.map((l) => l.t)
			.filter((t) => t.includes('image still has watchers'))
			.map((t) => t.match(/rbd rm '([^']+)'/)?.[1])
			.filter((name): name is string => !!name);
	}

	private async retryLeakedDiskRemoval(node: string, vmid: number, disks: string[]): Promise<void> {
		const storage = config.proxmox.vmDiskStorage;
		let remaining = disks;
		for (let attempt = 1; remaining.length > 0 && attempt <= 3; attempt++) {
			await new Promise((r) => setTimeout(r, 5_000 * attempt));
			const stillLeaked: string[] = [];
			for (const disk of remaining) {
				try {
					const upid = await this.client.deleteStorageVolume(node, storage, `${storage}:${disk}`);
					await this.client.waitForTask(node, upid);
				} catch (err) {
					if (err instanceof HTTPError && err.response.status === 404) continue;
					stillLeaked.push(disk);
				}
			}
			remaining = stillLeaked;
		}
		if (remaining.length > 0) {
			console.error(`VM ${vmid} on ${node} destroyed but left undeletable disks`, remaining);
		}
	}

	private async ensureVmStopped(node: string, vmid: number): Promise<void> {
		const status = await this.client.getQemuVm(node, vmid);
		if (status.status === 'stopped') return;

		const stopUpid = await this.forceStopVm(node, vmid);
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

	private async forceStopVm(node: string, vmid: number): Promise<string> {
		try {
			return await this.client.stopVm(node, vmid, { overruleShutdown: true });
		} catch (err) {
			if (!(err instanceof HTTPError) || err.response.status !== 400) throw err;
			return await this.client.stopVm(node, vmid);
		}
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
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const upid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async stopVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const upid = await this.client.shutdownVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async killVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const upid = await this.forceStopVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async rebootVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
		const upid = await this.client.rebootVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async resizeVm(id: string, params: VmResizeParams, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		try {
			const { node, vmid } = await this.resolveForMutation(id, proxmoxId);
			const config = await this.client.getQemuConfig(node, vmid);
			const currentDiskGb = parseDiskSizeGb(config.virtio0);
			if (currentDiskGb == null) {
				throw new VmResizeError(`Could not determine the current disk size of VM ${vmid}`);
			}
			if (params.diskGb < currentDiskGb) {
				throw new VmResizeError(
					`Disk cannot be shrunk from ${currentDiskGb}GB to ${params.diskGb}GB`
				);
			}
			if (params.diskGb > currentDiskGb) {
				await this.client.resizeDisk(node, vmid, 'virtio0', `${params.diskGb}G`);
			}

			const updates: Record<string, unknown> = {};
			if (params.cores !== config.cores) updates.cores = params.cores;
			if (params.memoryMb !== config.memory) updates.memory = params.memoryMb;
			if (Object.keys(updates).length > 0) {
				await this.client.updateQemuConfig(node, vmid, updates);
			}
		} finally {
			clearProxmoxReadCaches();
		}
	}
}

const diskSizeUnitsToGb: Record<string, number> = {
	'': 1 / 1024 ** 3,
	K: 1 / 1024 ** 2,
	M: 1 / 1024,
	G: 1,
	T: 1024
};

function parseDiskSizeGb(driveSpec: string | undefined): number | null {
	const match = driveSpec?.match(/(?:^|,)size=(\d+(?:\.\d+)?)([KMGT]?)(?:,|$)/i);
	if (!match) return null;
	const amount = Number.parseFloat(match[1]);
	const unit = match[2].toUpperCase();
	return Number.isFinite(amount) ? amount * diskSizeUnitsToGb[unit] : null;
}
