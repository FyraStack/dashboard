import { Address4, Address6 } from 'ip-address';
import ky, { HTTPError } from 'ky';
import type { MetricsTimeframe } from 'stack-shared/compute';
import type { VmPowerState } from 'stack-shared/vm-status';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { instrument } from '#lib/server/observability.js';
import type { VpcFetch } from '#lib/server/vpc.js';
import type {
	BackendImage,
	BackendImageImportParams,
	BackendImageImportTarget,
	VmConfigureParams,
	VmCreateParams,
	VmCreateResult,
	VmInfo,
	VmLookupOptions,
	VmMetricsHistorySample,
	VmResizeParams
} from '../types.ts';
import { VmNotFoundError, VmResizeError } from '../types.ts';
import type { ProxmoxClient } from './client.ts';
import type { PveClusterResource } from './types.ts';

const TAG_SEPARATORS = /[;,]/;
const TRAILING_SLASHES = /\/+$/;
const RBD_RM_IMAGE = /rbd rm '([^']+)'/;
const DISK_SIZE_OPTION = /(?:^|,)size=(\d+(?:\.\d+)?)([KMGT]?)(?:,|$)/i;

const VM_DISK_STORAGE = 'stack-volumes';
const TENANT_POOL = 'stack-tenants';
const VM_BRIDGE = 'public';
const VM_NET_RATE_MBPS = 128;
const IPV6_DEFAULT_GATEWAY = 'fe80::1040:ffff';
const NAT64_PREFIX = '64:ff9b::/96';
const NAT64_DNS64_SERVER = '2602:f41f:10:1040::ffff';
const NAMESERVERS = ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001'];
const BOOT_DISK = 'virtio0';

interface ResolvedVm {
	node: string;
	vmid: number;
}

const STABLE_ID_TAG_PREFIX = 'vmid-';

function haResourceId(vmid: number) {
	return `vm:${vmid}`;
}

function toStableId(id: string) {
	return id.toLowerCase();
}

export function findLiveVm(liveVms: VmInfo[], row: { id: string }): VmInfo | null {
	const stableId = toStableId(row.id);
	return liveVms.find((vm) => vm.stableId === stableId) ?? null;
}

function stableIdTag(id: string) {
	return `${STABLE_ID_TAG_PREFIX}${toStableId(id)}`;
}

function stableIdFromTags(tags: string | undefined): string | undefined {
	if (!tags) {
		return undefined;
	}
	const tag = tags
		.split(TAG_SEPARATORS)
		.map((entry) => toStableId(entry.trim()))
		.find((entry) => entry.startsWith(STABLE_ID_TAG_PREFIX));
	return tag ? tag.slice(STABLE_ID_TAG_PREFIX.length) : undefined;
}

interface CacheEntry<T> {
	expiresAt: number;
	promise: Promise<T>;
}

const CLUSTER_RESOURCES_TTL_MS = 2000;
const VM_STATUS_TTL_MS = 1000;
const RUNNING_CONFIRMATION_TIMEOUT_MS = 30_000;
const VM_STOP_TIMEOUT_MS = 60_000;
const HA_STOP_TIMEOUT_MS = 120_000;
const VM_STATE_POLL_INTERVAL_MS = 1000;
const DISK_READY_TIMEOUT_MS = 10 * 60_000;
const DISK_READY_POLL_INTERVAL_MS = 5000;
const IPSET_NAME = 'ipfilter-net0';
const HOST_PREFIX_LENGTH = /\/(32|128)$/;
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
	if (existing && existing.expiresAt > now) {
		return existing.promise;
	}

	let promise: Promise<T>;
	promise = load().catch((error) => {
		if (cache.get(key)?.promise === promise) {
			cache.delete(key);
		}
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

interface ProxmoxBackendOptions {
	excludedNodes: string[];
	firewallSecurityGroup?: string;
	snippetsEndpointPassword: string;
	snippetsEndpointUrl: string;
	snippetsEndpointUsername: string;
	snippetsFetch: VpcFetch;
	snippetsStorage?: string;
	vmCpuType?: string;
}

const UNSCHEDULABLE_HA_STATES = new Set(['maintenance', 'fence', 'gone']);

interface CloudInitVendorConfigParams {
	enableSshPasswordAuth?: boolean;
	ipv4Gateway?: string;
	ipv6ExtraRoutes?: string[];
	ipv6Gateway?: string;
}

function nat64Settings(network: VmCreateParams['networkConfig']) {
	const ipv6Only = !network?.ipv4 && Boolean(network?.ipv6 || network?.ipv6Prefix);
	return ipv6Only ? { prefix: NAT64_PREFIX, dns64Server: NAT64_DNS64_SERVER } : null;
}

function cloudInitVendorConfigParams(params: VmCreateParams): CloudInitVendorConfigParams {
	const network = params.networkConfig;
	const nat64 = nat64Settings(network);
	return {
		enableSshPasswordAuth: Boolean(params.password),
		ipv4Gateway: network?.ipv4?.gateway || undefined,
		ipv6Gateway: network?.ipv6 ? IPV6_DEFAULT_GATEWAY : undefined,
		ipv6ExtraRoutes: nat64 ? [nat64.prefix] : []
	};
}

const CLOUD_INIT_INTERFACE = 'eth0';

/**
 * cloud-init drops `on-link`/`scope` when converting v2 network config for
 * non-netplan renderers (ENI on Alpine, NM/sysconfig on RHEL-likes), and the
 * ENI renderer emits `ip route add ... via <gw>` without `dev`. With a /32
 * address and a link-local IPv6 gateway, both default routes silently fail.
 * Re-apply them with an explicit device on every boot; `replace` makes this a
 * no-op where the renderer already got it right.
 */
function cloudInitRouteBootcmd(params: CloudInitVendorConfigParams) {
	const dev = CLOUD_INIT_INTERFACE;
	const commands: string[] = [];

	if (params.ipv4Gateway && Address4.isValid(params.ipv4Gateway)) {
		const gw = params.ipv4Gateway;
		commands.push(
			`ip route replace ${gw}/32 dev ${dev} scope link || true`,
			`ip route replace default via ${gw} dev ${dev} onlink || true`
		);
	}

	if (params.ipv6Gateway && Address6.isValid(params.ipv6Gateway)) {
		const gw = params.ipv6Gateway;
		commands.push(`ip -6 route replace default via ${gw} dev ${dev} onlink || true`);
		for (const route of params.ipv6ExtraRoutes ?? []) {
			if (Address6.isValid(route)) {
				commands.push(`ip -6 route replace ${route} via ${gw} dev ${dev} onlink || true`);
			}
		}
	}

	return commands;
}

// SMBIOS type 1 (System Information) shown to the guest via dmidecode,
// /sys/class/dmi/id/*, and `hostnamectl` (Hardware Vendor / Hardware Model).
// https://pve.proxmox.com/pve-docs/qm.1.html (smbios1)
// Product is the VM's tier (vm_types.name), so it's rewritten on resize.
const SMBIOS_BRAND = 'Fyra Stack';

interface Smbios1 {
	fields: Record<string, string>;
	uuid?: string;
}

function smbios1Branding(stableId: string, tierName: string): Record<string, string> {
	return {
		manufacturer: SMBIOS_BRAND,
		product: tierName,
		family: SMBIOS_BRAND,
		serial: toStableId(stableId)
	};
}

function encodeBase64Utf8(value: string) {
	return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function decodeBase64Utf8(value: string) {
	return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

function parseSmbios1(raw: string | undefined): Smbios1 {
	const entries = (raw ?? '')
		.split(',')
		.filter(Boolean)
		.map((part) => {
			const eq = part.indexOf('=');
			return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
		});
	const base64 = entries.some(([key, value]) => key === 'base64' && value === '1');
	const result: Smbios1 = { fields: {} };
	for (const [key, value] of entries) {
		if (key === 'base64') {
			continue;
		}
		if (key === 'uuid') {
			result.uuid = value;
		} else {
			result.fields[key] = base64 ? decodeBase64Utf8(value) : value;
		}
	}
	return result;
}

function formatSmbios1({ fields, uuid }: Smbios1) {
	const encoded = Object.entries(fields).map(([key, value]) => `${key}=${encodeBase64Utf8(value)}`);
	return ['base64=1', ...encoded, ...(uuid ? [`uuid=${uuid}`] : [])].join(',');
}

function smbios1Config(stableId: string, tierName: string) {
	// PVE only auto-generates the SMBIOS UUID when smbios1 is omitted, so supply one ourselves.
	return formatSmbios1({
		fields: smbios1Branding(stableId, tierName),
		uuid: crypto.randomUUID()
	});
}

function rebrandSmbios1(raw: string | undefined, stableId: string, tierName: string) {
	const current = parseSmbios1(raw);
	const branding = smbios1Branding(stableId, tierName);
	if (
		current.uuid &&
		Object.entries(branding).every(([key, value]) => current.fields[key] === value)
	) {
		return null;
	}
	return formatSmbios1({
		fields: { ...current.fields, ...branding },
		// Keep the existing UUID: guests (and licensing/activation) key off it.
		uuid: current.uuid ?? crypto.randomUUID()
	});
}

function firstIpv6AddressInPrefix(prefix: string) {
	if (!Address6.isValid(prefix)) {
		return null;
	}

	const address = new Address6(prefix);
	return `${Address6.fromBigInt(address.startAddress().bigInt() + 1n).correctForm()}/${address.subnetMask}`;
}

function cloudInitVendorConfig(params: CloudInitVendorConfigParams) {
	const routeBootcmd = cloudInitRouteBootcmd(params);
	const yamlContents = `#cloud-config\n${stringifyYaml({
		ssh_deletekeys: false,
		...(routeBootcmd.length > 0 ? { bootcmd: routeBootcmd } : {}),
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
	const vendorData: unknown = parseYaml(vendorConfig);
	if (!vendorData || typeof vendorData !== 'object' || Array.isArray(vendorData)) {
		throw new Error('Dashboard-managed cloud-init vendor data is not a YAML object');
	}

	return `#cloud-config\n${stringifyYaml({ ...vendorData, ssh_deletekeys: false })}`;
}

function cloudInitNetworkConfig(params: VmCreateParams) {
	const nat64 = nat64Settings(params.networkConfig);
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
		// No gateway-less `scope: link` route here: cloud-init's ENI renderer (Alpine)
		// crashes on routes without `via`. The bootcmd in vendor data adds it instead.
		...(params.networkConfig?.ipv4?.gateway
			? [{ to: '0.0.0.0/0', via: params.networkConfig.ipv4.gateway, 'on-link': true }]
			: []),
		...(params.networkConfig?.ipv6
			? [
					{ to: '::/0', via: IPV6_DEFAULT_GATEWAY, 'on-link': true },
					...(nat64 ? [{ to: nat64.prefix, via: IPV6_DEFAULT_GATEWAY, 'on-link': true }] : [])
				]
			: [])
	];

	const yamlContents = stringifyYaml({
		version: 2,
		ethernets: {
			public0: {
				match: { macaddress: params.macAddress.toLowerCase() },
				'set-name': CLOUD_INIT_INTERFACE,
				dhcp4: false,
				dhcp6: false,
				addresses,
				routes,
				nameservers: {
					addresses: nat64 ? [nat64.dns64Server, ...NAMESERVERS] : NAMESERVERS
				}
			}
		}
	});

	return yamlContents;
}

function mapStatus(status: string): VmPowerState {
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

function usageRatio(used: number | undefined, max: number | undefined) {
	return typeof used === 'number' && max ? used / max : undefined;
}

export class ProxmoxBackend {
	private readonly client: ProxmoxClient;
	private readonly options: ProxmoxBackendOptions;

	constructor(client: ProxmoxClient, options: ProxmoxBackendOptions) {
		this.client = client;
		this.options = options;
	}

	private async isOwnedBy(id: string, candidate: ResolvedVm): Promise<boolean> {
		const vmConfig = await this.getCachedQemuConfig(candidate.node, candidate.vmid);
		const claimed = stableIdFromTags(typeof vmConfig.tags === 'string' ? vmConfig.tags : undefined);
		return claimed === toStableId(id);
	}

	private async resolveFromHint(
		id: string,
		proxmoxId?: number,
		proxmoxNode?: string
	): Promise<ResolvedVm | null> {
		if (!proxmoxNode || proxmoxId === undefined) {
			return null;
		}
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
		const expectedStableId = toStableId(id);
		const match = resources.find(
			(r) => r.type === 'qemu' && stableIdFromTags(r.tags) === expectedStableId
		);

		if (!match?.node || typeof match.vmid !== 'number') {
			throw new VmNotFoundError(`VM "${id}" not found on any Proxmox node`);
		}

		return { node: match.node, vmid: match.vmid };
	}

	private getClusterResources(type?: 'vm' | 'storage' | 'node') {
		return getCached(clusterResourcesCache, type ?? 'all', CLUSTER_RESOURCES_TTL_MS, () =>
			this.client.getClusterResources(type)
		);
	}

	private async startAndAwaitRunning(node: string, vmid: number) {
		const startUpid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, startUpid);
		try {
			await this.awaitVmStatus(node, vmid, 'running', RUNNING_CONFIRMATION_TIMEOUT_MS);
		} finally {
			clearProxmoxReadCaches();
		}
	}

	async finishProvisioning(id: string, proxmoxId: number, params: { diskGb: number }) {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
		const currentDiskGb = await this.awaitBootDiskGb(node, vmid);
		if (params.diskGb > currentDiskGb) {
			await this.resizeBootDisk(node, vmid, params.diskGb);
		}
		const current = await this.client.getQemuVm(node, vmid);
		if (current.status !== 'running') {
			await this.startAndAwaitRunning(node, vmid);
		}
		clearProxmoxReadCaches();
	}

	private async awaitBootDiskGb(node: string, vmid: number): Promise<number> {
		const deadline = Date.now() + DISK_READY_TIMEOUT_MS;
		while (Date.now() < deadline) {
			// biome-ignore lint/performance/noAwaitInLoops: polling Proxmox until the disk import releases the config lock is inherently sequential
			const qemuConfig = await this.client.getQemuConfig(node, vmid);
			const diskGb = parseDiskSizeGb(qemuConfig[BOOT_DISK]);
			if (!qemuConfig.lock && diskGb !== null) {
				return diskGb;
			}
			await new Promise((r) => setTimeout(r, DISK_READY_POLL_INTERVAL_MS));
		}
		throw new Error(
			`VM ${vmid} on ${node} boot disk was not ready within ${DISK_READY_TIMEOUT_MS}ms`
		);
	}

	private async resizeBootDisk(node: string, vmid: number, diskGb: number) {
		const upid = await this.client.resizeDisk(node, vmid, BOOT_DISK, `${diskGb}G`);
		if (upid) {
			await this.client.waitForTask(node, upid);
		}
	}

	async waitForTask(node: string, upid: string, timeoutMs: number): Promise<void> {
		await this.client.waitForTask(node, upid, { timeoutMs });
	}

	private getCachedQemuVm(node: string, vmid: number) {
		return getCached(vmStatusCache, `${node}:${vmid}`, VM_STATUS_TTL_MS, () =>
			this.client.getQemuVm(node, vmid)
		);
	}

	private getCachedQemuConfig(node: string, vmid: number) {
		return getCached(vmConfigCache, `${node}:${vmid}`, CLUSTER_RESOURCES_TTL_MS, () =>
			this.client.getQemuConfig(node, vmid)
		);
	}

	async ping(): Promise<void> {
		await this.client.listNodes();
	}

	private resourceToInfo(r: PveClusterResource): VmInfo {
		const stableId = stableIdFromTags(r.tags);
		return {
			id: stableId ?? r.name ?? String(r.vmid),
			stableId,
			proxmoxId: r.vmid,
			proxmoxNode: r.node,
			name: r.name ?? `VM ${r.vmid}`,
			status: mapStatus(r.status ?? 'unknown'),
			cores: r.maxcpu ?? 0,
			memory: r.maxmem ?? 0,
			disk: r.maxdisk ?? 0,
			uptime: r.uptime ?? 0,
			metrics: {
				cpu: r.cpu,
				memory: usageRatio(r.mem, r.maxmem),
				disk: usageRatio(r.disk, r.maxdisk)
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
		if (this.options.snippetsStorage) {
			return this.options.snippetsStorage;
		}

		const storages = await this.client.listStorage(node);
		const storage = storages.find(
			(candidate) =>
				this.storageSupportsContent(candidate.content, 'snippets') &&
				candidate.active !== 0 &&
				candidate.enabled !== 0
		);

		if (!storage) {
			throw new Error(
				`No active Proxmox storage on node "${node}" supports snippets. Set PROXMOX_SNIPPETS_STORAGE to the storage id used by pvecic-snippets-endpoint.`
			);
		}

		return storage.storage;
	}

	private async requestSnippet(method: 'get' | 'put', filename: string, content?: string) {
		const { snippetsEndpointUrl, snippetsEndpointUsername, snippetsEndpointPassword } =
			this.options;
		const action = method === 'put' ? 'upload' : 'read';

		try {
			return await ky(
				`${snippetsEndpointUrl.replace(TRAILING_SLASHES, '')}/${encodeURIComponent(filename)}`,
				{
					method,
					headers: {
						Authorization: `Basic ${Buffer.from(`${snippetsEndpointUsername}:${snippetsEndpointPassword}`).toString('base64')}`,
						...(content === undefined ? {} : { 'Content-Type': 'text/cloud-config' })
					},
					body: content,
					timeout: 60_000,
					fetch: this.options.snippetsFetch
				}
			).text();
		} catch (err) {
			if (err instanceof HTTPError) {
				const body = await err.response.text().catch(() => '<unreadable response body>');
				throw new Error(
					`Snippet endpoint ${action} failed for ${filename}: ${err.response.status} ${err.response.statusText} - ${body}`,
					{ cause: err }
				);
			}

			const cause = err instanceof Error && err.cause ? `: ${String(err.cause)}` : '';
			throw new Error(`Snippet endpoint ${action} failed for ${filename}: ${String(err)}${cause}`, {
				cause: err
			});
		}
	}

	private async uploadSnippet(filename: string, content: string) {
		await this.requestSnippet('put', filename, content);
	}

	private readSnippet(filename: string) {
		return this.requestSnippet('get', filename);
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
		return new Set(resources.flatMap((r) => (typeof r.vmid === 'number' ? [r.vmid] : [])));
	}

	private async listSchedulableNodes() {
		const [nodes, resources] = await Promise.all([
			this.client.listNodes(),
			this.getClusterResources('node')
		]);
		const haStateByNode = new Map(resources.map((r) => [r.node, r.hastate]));
		const excluded = new Set(this.options.excludedNodes);
		const schedulable = nodes.filter((node) => {
			if (node.status !== 'online') {
				return false;
			}
			if (excluded.has(node.node)) {
				return false;
			}
			const haState = haStateByNode.get(node.node);
			return !(haState && UNSCHEDULABLE_HA_STATES.has(haState));
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

	importImageFromUrl(params: BackendImageImportParams): Promise<string> {
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

		return {
			id,
			stableId: toStableId(id),
			proxmoxId: vmid,
			proxmoxNode: node,
			name: status.name ?? `VM ${status.vmid}`,
			status: mapStatus(status.status),
			cores: status.cpus ?? 0,
			memory: status.maxmem ?? 0,
			disk: status.maxdisk ?? 0,
			uptime: status.uptime ?? 0,
			metrics: {
				cpu: status.cpu,
				memory: usageRatio(status.mem, status.maxmem),
				disk: usageRatio(status.disk, status.maxdisk),
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
		timeframe: MetricsTimeframe,
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
			memory: usageRatio(sample.mem, sample.maxmem) ?? null,
			bandwidth:
				typeof sample.netin !== 'number' && typeof sample.netout !== 'number'
					? null
					: (sample.netin ?? 0) + (sample.netout ?? 0),
			diskIo:
				typeof sample.diskread !== 'number' && typeof sample.diskwrite !== 'number'
					? null
					: (sample.diskread ?? 0) + (sample.diskwrite ?? 0)
		}));
	}

	async createVm(params: VmCreateParams): Promise<VmCreateResult> {
		clearProxmoxReadCaches();
		const vmid = params.proxmoxId;
		const nodes = await this.listSchedulableNodes();
		const [node] = nodes.sort((a, b) => b.maxmem - b.mem - (a.maxmem - a.mem));

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
		const pvePool = VM_DISK_STORAGE;
		const { macAddress } = params;
		const cloudInitNetworkConfigFilename = `stack-${vmid}-network.yaml`;
		const cloudInitVendorConfigFilename = `stack-${vmid}-vendor.yaml`;
		const cloudInitSnippetStorage = await this.snippetStorage(node.node);
		const cloudInitNetworkConfigVolid = `${cloudInitSnippetStorage}:snippets/${cloudInitNetworkConfigFilename}`;
		const cloudInitVendorConfigVolid = `${cloudInitSnippetStorage}:snippets/${cloudInitVendorConfigFilename}`;
		await Promise.all([
			this.uploadSnippet(cloudInitNetworkConfigFilename, cloudInitNetworkConfig(params)),
			this.uploadSnippet(
				cloudInitVendorConfigFilename,
				cloudInitVendorConfig(cloudInitVendorConfigParams(params))
			)
		]);

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
			smbios1: smbios1Config(params.id, params.tierName),
			scsihw: 'virtio-scsi-single',
			...(params.imageSource
				? {}
				: { [BOOT_DISK]: `${pvePool}:${params.diskGb},cache=writeback,discard=on,iothread=1` }),
			ide2: `${pvePool}:cloudinit`,
			net0: `virtio=${macAddress},bridge=${VM_BRIDGE},firewall=1,rate=${VM_NET_RATE_MBPS}`,
			pool: TENANT_POOL,
			boot: `order=${BOOT_DISK}`,
			cicustom: `network=${cloudInitNetworkConfigVolid},vendor=${cloudInitVendorConfigVolid}`,
			ciupgrade: 0,
			...cloudInitAuth,
			serial0: 'socket',
			agent: '1',
			tags: `${stableIdTag(params.id)};projectid-${params.projectId};userid-${params.userId}`,
			'ha-managed': 1
		});
		clearProxmoxReadCaches();
		return {
			proxmoxId: vmid,
			proxmoxNode: node.node,
			macAddress,
			taskId: createUpid
		};
	}

	async configureVm(params: VmConfigureParams): Promise<string | null> {
		const { proxmoxNode: node, proxmoxId: vmid } = params;
		await this.client.waitForTask(node, params.createTaskId);
		await this.configureFirewall(node, vmid, [...new Set(params.firewallIpSet)]);
		const importTaskId = params.imageSource
			? await this.startBootDiskImport(node, vmid, params.imageSource)
			: null;
		clearProxmoxReadCaches();
		return importTaskId;
	}

	private async configureFirewall(node: string, vmid: number, ipSet: string[]) {
		await this.client.updateQemuFirewallOptions(node, vmid, {
			enable: 1,
			policy_in: 'ACCEPT',
			policy_out: 'ACCEPT',
			ipfilter: 1,
			macfilter: 1,
			ndp: 1,
			dhcp: 0
		});

		const securityGroup = this.options.firewallSecurityGroup;
		if (securityGroup) {
			const rules = await this.client.listQemuFirewallRules(node, vmid);
			if (!rules.some((rule) => rule.type === 'group' && rule.action === securityGroup)) {
				await this.client.addQemuFirewallSecurityGroupRule(node, vmid, securityGroup);
			}
		}

		if (ipSet.length === 0) {
			return;
		}
		await this.client.createQemuFirewallIpset(node, vmid, IPSET_NAME);
		const existing = new Set(
			(await this.client.listQemuFirewallIpsetEntries(node, vmid, IPSET_NAME)).map(
				(entry) => entry.cidr
			)
		);
		const missing = ipSet.filter(
			(cidr) => !(existing.has(cidr) || existing.has(cidr.replace(HOST_PREFIX_LENGTH, '')))
		);
		await Promise.all(
			missing.map((cidr) =>
				this.client.addQemuFirewallIpsetEntry(node, vmid, IPSET_NAME, cidr, 'stack-ipam')
			)
		);
	}

	private async startBootDiskImport(
		node: string,
		vmid: number,
		imageSource: string
	): Promise<string | null> {
		const qemuConfig = await this.client.getQemuConfig(node, vmid);
		if (qemuConfig.lock || qemuConfig[BOOT_DISK]) {
			return null;
		}
		return await this.client.updateQemuConfigAsync(node, vmid, {
			[BOOT_DISK]: `${VM_DISK_STORAGE}:0,import-from=${imageSource},cache=writeback,discard=on,iothread=1`
		});
	}

	async updateVmHostname(id: string, hostname: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
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
			resolved = await this.resolveVerified(id, proxmoxId);
		} catch (err) {
			if (err instanceof VmNotFoundError) {
				return;
			}
			throw err;
		}

		const { node, vmid } = resolved;

		try {
			await this.disableHaAndAwaitStop(node, vmid);
			await this.ensureVmStopped(node, vmid);
		} catch (err) {
			if (err instanceof HTTPError && err.response.status === 404) {
				return;
			}
			throw err;
		}

		await this.destroyVmAndWait(node, vmid);
	}

	private async destroyVmAndWait(node: string, vmid: number): Promise<void> {
		// Ceph RBD can still hold watchers on a just-stopped VM's images, and destroying immediately can end with "image still has watchers" warnings.
		await new Promise((r) => setTimeout(r, 3000));
		const upid = await this.destroyVm(node, vmid);
		if (!upid) {
			return;
		}
		const status = await this.client.waitForTask(node, upid);
		const leaked = await this.leakedDisksAfterDestroy(node, upid, status.exitstatus);
		if (leaked.length > 0) {
			await this.retryLeakedDiskRemoval(node, vmid, leaked);
		}
	}

	private async leakedDisksAfterDestroy(
		node: string,
		upid: string,
		exitstatus?: string
	): Promise<string[]> {
		if (!exitstatus?.startsWith('WARNINGS:')) {
			return [];
		}
		const lines = await this.client.getTaskLog(node, upid);
		return lines
			.map((l) => l.t)
			.filter((t) => t.includes('image still has watchers'))
			.map((t) => t.match(RBD_RM_IMAGE)?.[1])
			.filter((name): name is string => !!name);
	}

	private async retryLeakedDiskRemoval(node: string, vmid: number, disks: string[]): Promise<void> {
		const storage = VM_DISK_STORAGE;
		let remaining = disks;
		for (let attempt = 1; remaining.length > 0 && attempt <= 3; attempt += 1) {
			// Ceph RBD refuses `rbd rm` while "image still has watchers" and only succeeds once the stale watcher expires, so wait longer each round.
			// biome-ignore lint/performance/noAwaitInLoops: backoff delay between retry rounds is intentionally sequential
			await new Promise((r) => setTimeout(r, 5000 * attempt));
			const stillLeaked: string[] = [];
			for (const disk of remaining) {
				try {
					// biome-ignore lint/performance/noAwaitInLoops: Proxmox storage deletes on a node are serialized, so volumes are removed one at a time
					const upid = await this.client.deleteStorageVolume(node, storage, `${storage}:${disk}`);
					await this.client.waitForTask(node, upid);
				} catch (err) {
					if (err instanceof HTTPError && err.response.status === 404) {
						continue;
					}
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
		if (status.status === 'stopped') {
			return;
		}

		const stopUpid = await this.forceStopVm(node, vmid);
		try {
			await this.client.waitForTask(node, stopUpid);
		} catch (err) {
			const current = await this.client.getQemuVm(node, vmid);
			if (current.status !== 'stopped') {
				throw err;
			}
		}

		await this.awaitVmStatus(node, vmid, 'stopped', VM_STOP_TIMEOUT_MS);
	}

	private async awaitVmStatus(
		node: string,
		vmid: number,
		target: 'running' | 'stopped',
		timeoutMs: number
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			// biome-ignore lint/performance/noAwaitInLoops: polling Proxmox until the VM reports the target status is inherently sequential
			const current = await this.client.getQemuVm(node, vmid);
			if (current.status === target) {
				return;
			}
			await new Promise((r) => setTimeout(r, VM_STATE_POLL_INTERVAL_MS));
		}
		throw new Error(
			`VM ${vmid} on node ${node} did not reach ${target} state within ${timeoutMs}ms`
		);
	}

	private async disableHa(vmid: number): Promise<boolean> {
		const sid = haResourceId(vmid);
		const resources = await this.client.listHaResources();
		const resource = resources.find((candidate) => candidate.sid === sid);
		if (!resource || resource.state === 'disabled') {
			return false;
		}
		await this.client.setHaResourceState(sid, 'disabled');
		return true;
	}

	private async disableHaAndAwaitStop(node: string, vmid: number): Promise<void> {
		if (!(await this.disableHa(vmid))) {
			return;
		}
		await this.awaitVmStatus(node, vmid, 'stopped', HA_STOP_TIMEOUT_MS).catch((err) => {
			console.warn(`VM ${vmid} on ${node} did not stop after disabling HA, forcing stop`, err);
		});
	}

	private async withHaRecovery(
		node: string,
		vmid: number,
		target: 'running' | 'stopped',
		action: () => Promise<void>
	): Promise<void> {
		try {
			await action();
			return;
		} catch (err) {
			const current = await this.client.getQemuVm(node, vmid);
			if (current.status === target) {
				return;
			}
			if (!(await this.disableHa(vmid))) {
				throw err;
			}
			console.warn(
				`VM ${vmid} on ${node} failed to reach ${target}, recovering via HA disable`,
				err
			);
		}

		await this.awaitVmStatus(node, vmid, 'stopped', HA_STOP_TIMEOUT_MS);
		if (target === 'running') {
			const startUpid = await this.client.startVm(node, vmid);
			await this.client.waitForTask(node, startUpid);
		}
		await this.client.setHaResourceState(
			haResourceId(vmid),
			target === 'running' ? 'started' : 'stopped'
		);
	}

	private async forceStopVm(node: string, vmid: number): Promise<string> {
		try {
			return await this.client.stopVm(node, vmid, { overruleShutdown: true });
		} catch (err) {
			if (!(err instanceof HTTPError) || err.response.status !== 400) {
				throw err;
			}
			return await this.client.stopVm(node, vmid);
		}
	}

	private async destroyVm(node: string, vmid: number): Promise<string | undefined> {
		for (let attempt = 1; ; attempt += 1) {
			try {
				// biome-ignore lint/performance/noAwaitInLoops: destroy retries must wait for the previous attempt and the VM to stop
				return await this.client.deleteQemuVm(node, vmid, {
					purge: true,
					destroyUnreferencedDisks: true
				});
			} catch (err) {
				if (err instanceof HTTPError && err.response.status === 404) {
					return undefined;
				}
				if (!(err instanceof HTTPError) || attempt >= 3) {
					throw err;
				}
				await new Promise((r) => setTimeout(r, 2000));
				await this.ensureVmStopped(node, vmid);
			}
		}
	}

	async startVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
		await this.withHaRecovery(node, vmid, 'running', async () => {
			await this.client.waitForTask(node, await this.client.startVm(node, vmid));
		});
	}

	async stopVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
		await this.withHaRecovery(node, vmid, 'stopped', async () => {
			await this.client.waitForTask(node, await this.client.shutdownVm(node, vmid));
		});
	}

	async killVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
		await this.withHaRecovery(node, vmid, 'stopped', async () => {
			await this.client.waitForTask(node, await this.forceStopVm(node, vmid));
		});
	}

	async rebootVm(id: string, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		const { node, vmid } = await this.resolveVerified(id, proxmoxId);
		await this.withHaRecovery(node, vmid, 'running', async () => {
			await this.client.waitForTask(node, await this.client.rebootVm(node, vmid));
		});
	}

	async resizeVm(id: string, params: VmResizeParams, proxmoxId?: number): Promise<void> {
		clearProxmoxReadCaches();
		try {
			const { node, vmid } = await this.resolveVerified(id, proxmoxId);
			const qemuConfig = await this.client.getQemuConfig(node, vmid);
			const currentDiskGb = parseDiskSizeGb(qemuConfig[BOOT_DISK]);
			if (currentDiskGb === null) {
				throw new VmResizeError(`Could not determine the current disk size of VM ${vmid}`);
			}
			if (params.diskGb < currentDiskGb) {
				throw new VmResizeError(
					`Disk cannot be shrunk from ${currentDiskGb}GB to ${params.diskGb}GB`
				);
			}
			if (params.diskGb > currentDiskGb) {
				await this.resizeBootDisk(node, vmid, params.diskGb);
			}

			const updates: Record<string, unknown> = {};
			if (params.cores !== qemuConfig.cores) {
				updates.cores = params.cores;
			}
			if (params.memoryMb !== qemuConfig.memory) {
				updates.memory = params.memoryMb;
			}
			const smbios1 = rebrandSmbios1(qemuConfig.smbios1, id, params.tierName);
			if (smbios1) {
				updates.smbios1 = smbios1;
			}
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
	const match = driveSpec?.match(DISK_SIZE_OPTION);
	if (!match) {
		return null;
	}
	const amount = Number.parseFloat(match[1]);
	const unit = match[2].toUpperCase();
	return Number.isFinite(amount) ? amount * diskSizeUnitsToGb[unit] : null;
}
