export type VmStatus = 'running' | 'stopped' | 'paused' | 'unknown';

export interface VmInfo {
	id: string;
	proxmoxId?: number;
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
	macAddress?: string;
	networkConfig?: VmNetworkConfig;
	sshKeys?: string[];
	password?: string;
	/** Called when async provisioning (e.g. image import) finishes or fails. */
	onProvisionSettled?: (result: { ok: boolean; error?: string }) => void;
	projectId: string;
	userId: string;
}

export interface VmCreateResult {
	id: string;
	proxmoxId?: number;
	macAddress?: string;
	taskId?: string;
}

export interface VmBackend {
	readonly name: string;
	listVms(): Promise<VmInfo[]>;
	getVm(id: string, proxmoxId?: number): Promise<VmInfo>;
	getVmMetricsHistory(
		id: string,
		proxmoxId: number | undefined,
		timeframe: VmMetricsTimeframe
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
	getFirewallRules(id: string, proxmoxId?: number): Promise<FirewallRule[]>;
	createFirewallRule(params: FirewallRule, id: string, proxmoxId?: number): Promise<void>;
	editFirewallRule(
		params: FirewallRule,
		pos: number,
		id: string,
		proxmoxId?: number
	): Promise<void>;
	deleteFirewallRule(pos: number, id: string, proxmoxId?: number): Promise<void>;
}

export interface FirewallRule {
	action: 'ACCEPT' | 'DROP' | 'REJECT';
	type: 'in' | 'out' | 'forward';
	protocol?: string;
	destinationAddresses?: string;
	destinationPorts?: string;
	sourceAddresses?: string;
	sourcePorts?: string;
}
