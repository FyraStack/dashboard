export type VmStatus = 'running' | 'stopped' | 'paused' | 'unknown';

export interface VmInfo {
	cores: number;
	disk: number;
	id: string;
	memory: number;
	metrics?: VmMetrics;
	name: string;
	networkInterfaces?: Record<string, { ipAddresses?: string[] }>;
	proxmoxId?: number;
	proxmoxNode?: string;
	stableId?: string;
	status: VmStatus;
	uptime: number;
}

export interface VmMetrics {
	cpu?: number;
	disk?: number;
	diskRead?: number;
	diskWrite?: number;
	memory?: number;
	networkIn?: number;
	networkOut?: number;
}

export type VmMetricsTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface VmMetricsHistorySample {
	bandwidth: number | null;
	cpu: number | null;
	diskIo: number | null;
	memory: number | null;
	time: number;
}

export interface BackendImage {
	content: 'import';
	filename: string;
	format: string;
	node: string;
	size: number;
	storage: string;
	volid: string;
}

export interface BackendImageImportTarget {
	node: string;
	storage: string;
}

export interface BackendImageImportParams {
	checksum?: string;
	checksumAlgorithm?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
	filename: string;
	node: string;
	storage: string;
	url: string;
	verifyCertificates?: boolean;
}

export interface VmNetworkConfig {
	firewallIpSet?: string[];
	ipv4?: { address: string; prefixLength: number; gateway: string };
	ipv6?: { address: string; prefixLength: number };
	ipv6Prefix?: string;
	nat64Dns64Server?: string;
	nat64Prefix?: string;
}

export interface VmCreateParams {
	cores: number;
	diskGb: number;
	id: string;
	imageId?: string;
	imageSource?: string;
	macAddress?: string;
	memoryMb: number;
	name: string;
	networkConfig?: VmNetworkConfig;
	onProvisionSettled?: (result: { ok: boolean; error?: string }) => void | Promise<void>;
	password?: string;
	projectId: string;
	proxmoxId: number;
	registerBackground?: (work: Promise<unknown>, label?: string) => void;
	secureBoot?: boolean;
	sshKeys?: string[];
	userId: string;
}

export interface VmCreateResult {
	id: string;
	macAddress?: string;
	proxmoxId?: number;
	proxmoxNode?: string;
	taskId?: string;
}

export interface VmLookupOptions {
	includeNetworkInterfaces?: boolean;
	proxmoxNode?: string;
}

export interface VmResizeParams {
	cores: number;
	diskGb: number;
	memoryMb: number;
}

export class VmNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VmNotFoundError';
	}
}

export class VmResizeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VmResizeError';
	}
}

export interface VmBackend {
	createVm(params: VmCreateParams): Promise<VmCreateResult>;
	deleteVm(id: string, proxmoxId?: number): Promise<void>;
	finishProvisioning(
		id: string,
		proxmoxId: number | undefined,
		params: { diskGb: number },
		options?: Pick<VmLookupOptions, 'proxmoxNode'>
	): Promise<boolean>;
	getTaskStatus(
		node: string,
		upid: string
	): Promise<{ status: 'running' | 'stopped'; exitstatus?: string }>;
	getVm(id: string, proxmoxId?: number, options?: VmLookupOptions): Promise<VmInfo>;
	getVmMetricsHistory(
		id: string,
		proxmoxId: number | undefined,
		timeframe: VmMetricsTimeframe,
		options?: Pick<VmLookupOptions, 'proxmoxNode'>
	): Promise<VmMetricsHistorySample[]>;
	getVmNetworkInterfaces?(
		id: string,
		proxmoxId?: number,
		options?: Pick<VmLookupOptions, 'proxmoxNode'>
	): Promise<VmInfo['networkInterfaces']>;
	importImageFromUrl(params: BackendImageImportParams): Promise<string>;
	killVm(id: string, proxmoxId?: number): Promise<void>;
	listImageImportTargets(): Promise<BackendImageImportTarget[]>;
	listImages(): Promise<BackendImage[]>;
	listUsedProxmoxIds?(): Promise<Set<number>>;
	listVms(): Promise<VmInfo[]>;
	readonly name: string;
	ping(): Promise<void>;
	rebootVm(id: string, proxmoxId?: number): Promise<void>;
	resizeVm(id: string, params: VmResizeParams, proxmoxId?: number): Promise<void>;
	startVm(id: string, proxmoxId?: number): Promise<void>;
	stopVm(id: string, proxmoxId?: number): Promise<void>;
	updateVmHostname(id: string, hostname: string, proxmoxId?: number): Promise<void>;
}
