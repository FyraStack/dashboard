export type VmStatus = 'running' | 'stopped' | 'paused' | 'unknown';

export interface VmInfo {
	id: string;
	proxmoxId?: number;
	proxmoxNode?: string;
	name: string;
	status: VmStatus;
	cores: number;
	memory: number;
	disk: number;
	uptime: number;
	networkInterfaces?: Record<string, { ipAddresses?: string[] }>;
	metrics?: VmMetrics;
}

export interface VmMetrics {
	cpu?: number;
	memory?: number;
	disk?: number;
	networkIn?: number;
	networkOut?: number;
	diskRead?: number;
	diskWrite?: number;
}

export type VmMetricsTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface VmMetricsHistorySample {
	time: number;
	cpu: number | null;
	memory: number | null;
	bandwidth: number | null;
	diskIo: number | null;
}

export interface BackendImage {
	volid: string;
	filename: string;
	size: number;
	node: string;
	storage: string;
	content: 'import';
	format: string;
}

export interface BackendImageImportTarget {
	node: string;
	storage: string;
}

export interface BackendImageImportParams {
	node: string;
	storage: string;
	url: string;
	filename: string;
	checksum?: string;
	checksumAlgorithm?: 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
	verifyCertificates?: boolean;
}

export interface VmNetworkConfig {
	ipv4?: { address: string; prefixLength: number; gateway: string };
	ipv6?: { address: string; prefixLength: number };
	ipv6Prefix?: string;
	firewallIpSet?: string[];
}

export interface VmCreateParams {
	id: string;
	name: string;
	proxmoxId?: number;
	cores: number;
	memoryMb: number;
	diskGb: number;
	imageId?: string;
	imageSource?: string;
	secureBoot?: boolean;
	macAddress?: string;
	networkConfig?: VmNetworkConfig;
	sshKeys?: string[];
	password?: string;
	onProvisionSettled?: (result: { ok: boolean; error?: string }) => void | Promise<void>;
	registerBackground?: (work: Promise<unknown>, label?: string) => void;
	projectId: string;
	userId: string;
}

export interface VmCreateResult {
	id: string;
	proxmoxId?: number;
	proxmoxNode?: string;
	macAddress?: string;
	taskId?: string;
}

export interface VmLookupOptions {
	proxmoxNode?: string;
	includeNetworkInterfaces?: boolean;
}

export interface VmBackend {
	readonly name: string;
	listVms(): Promise<VmInfo[]>;
	getVm(id: string, proxmoxId?: number, options?: VmLookupOptions): Promise<VmInfo>;
	getVmNetworkInterfaces?(
		id: string,
		proxmoxId?: number,
		options?: Pick<VmLookupOptions, 'proxmoxNode'>
	): Promise<VmInfo['networkInterfaces']>;
	getVmMetricsHistory(
		id: string,
		proxmoxId: number | undefined,
		timeframe: VmMetricsTimeframe,
		options?: Pick<VmLookupOptions, 'proxmoxNode'>
	): Promise<VmMetricsHistorySample[]>;
	createVm(params: VmCreateParams): Promise<VmCreateResult>;
	deleteVm(id: string, proxmoxId?: number): Promise<void>;
	startVm(id: string, proxmoxId?: number): Promise<void>;
	stopVm(id: string, proxmoxId?: number): Promise<void>;
	killVm(id: string, proxmoxId?: number): Promise<void>;
	rebootVm(id: string, proxmoxId?: number): Promise<void>;
	listImages(): Promise<BackendImage[]>;
	listImageImportTargets(): Promise<BackendImageImportTarget[]>;
	importImageFromUrl(params: BackendImageImportParams): Promise<string>;
	getTaskStatus(
		node: string,
		upid: string
	): Promise<{ status: 'running' | 'stopped'; exitstatus?: string }>;
}
