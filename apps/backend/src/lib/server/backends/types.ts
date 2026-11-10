import type { ChecksumAlgorithm } from 'stack-shared/compute';
import type { VmPowerState } from 'stack-shared/vm-status';

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
	status: VmPowerState;
	uptime: number;
}

interface VmMetrics {
	cpu?: number;
	disk?: number;
	diskRead?: number;
	diskWrite?: number;
	memory?: number;
	networkIn?: number;
	networkOut?: number;
}

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

export type VmPowerAction = 'startVm' | 'stopVm' | 'killVm' | 'rebootVm';

export interface BackendImageImportParams {
	checksum?: string;
	checksumAlgorithm?: ChecksumAlgorithm;
	filename: string;
	node: string;
	storage: string;
	url: string;
	verifyCertificates?: boolean;
}

interface VmNetworkConfig {
	firewallIpSet?: string[];
	ipv4?: { address: string; prefixLength: number; gateway: string };
	ipv6?: { address: string; prefixLength: number };
	ipv6Prefix?: string;
}

export interface VmCreateParams {
	cores: number;
	diskGb: number;
	id: string;
	imageSource?: string;
	macAddress: string;
	memoryMb: number;
	name: string;
	networkConfig?: VmNetworkConfig;
	password?: string;
	projectId: string;
	proxmoxId: number;
	secureBoot?: boolean;
	sshKeys?: string[];
	tierName: string;
	userId: string;
}

export interface VmCreateResult {
	macAddress: string;
	proxmoxId: number;
	proxmoxNode: string;
	taskId: string;
}

export interface VmConfigureParams {
	createTaskId: string;
	firewallIpSet: string[];
	imageSource: string | null;
	proxmoxId: number;
	proxmoxNode: string;
}

export interface VmLookupOptions {
	proxmoxNode?: string;
}

export interface VmResizeParams {
	cores: number;
	diskGb: number;
	memoryMb: number;
	tierName: string;
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
