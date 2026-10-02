type ServerStatus =
	| 'running'
	| 'stopped'
	| 'restarting'
	| 'provisioning'
	| 'deleting'
	| 'error'
	| 'unknown';

interface VmSummary {
	active: boolean;
	creationDate: string;
	id: string;
	live: {
		name?: string | null;
		cores?: number | null;
		status?: string | null;
		memory?: number | null;
		disk?: number | null;
		uptime?: number | null;
		networkInterfaces?: Record<
			string,
			{
				ipAddresses?: string[] | null;
			}
		> | null;
		metrics?: {
			cpu?: number | null;
			memory?: number | null;
			disk?: number | null;
			networkIn?: number | null;
			networkOut?: number | null;
			diskRead?: number | null;
			diskWrite?: number | null;
		} | null;
	} | null;
	name: string;
	status?: string | null;
	vmType: {
		name: string;
		cores: number;
		ramCapacity: number;
		storageAmount: number;
	} | null;
}

type NetworkInterfaces = NonNullable<NonNullable<VmSummary['live']>['networkInterfaces']>;
interface ServerMetrics {
	cpu?: number | null;
	disk?: number | null;
	diskRead?: number | null;
	diskWrite?: number | null;
	memory?: number | null;
	networkIn?: number | null;
	networkOut?: number | null;
}

export interface ServerInfo {
	agentConnected: boolean;
	backups: boolean;
	created: string;
	disk: string;
	id: string;
	ip: string;
	ipv6: string;
	liveLoaded: boolean;
	metrics: ServerMetrics | null;
	name: string;
	plan: string;
	ram: string;
	region: string;
	status: ServerStatus;
	uptime: string;
	vcpu: number;
}

export function primaryAddress(server: Pick<ServerInfo, 'ip' | 'ipv6'>): string | null {
	if (server.ip && server.ip !== '-') {
		return server.ip;
	}
	if (server.ipv6 && server.ipv6 !== '-') {
		return server.ipv6;
	}
	return null;
}

export function formatBytes(bytes: number): string {
	if (!bytes) {
		return '0B';
	}
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1) {
		return `${gb.toFixed(0)}GB`;
	}
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)}MB`;
}

function formatUptime(seconds: number): string {
	if (!seconds) {
		return '-';
	}
	const d = Math.floor(seconds / 86_400);
	const h = Math.floor((seconds % 86_400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${d}d ${h}h ${m}m`;
}

function getFirstIp(
	networkInterfaces: NetworkInterfaces | null | undefined,
	match: (address: string) => boolean
): string {
	if (!networkInterfaces) {
		return '-';
	}

	return (
		Object.values(networkInterfaces)
			.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
			.find((address) => address && match(address)) ?? '-'
	);
}

function resolveServerStatus(vm: VmSummary): ServerStatus {
	if (vm.status === 'deleting' || vm.status === 'error' || vm.status === 'provisioning') {
		return vm.status;
	}
	switch (vm.live?.status) {
		case 'running':
			return 'running';
		case 'paused':
			return 'restarting';
		case 'stopped':
			return 'stopped';
		default:
			return 'unknown';
	}
}

export function toServerInfo(vm: VmSummary): ServerInfo {
	const liveLoaded = Boolean(vm.live) && vm.live?.status !== 'unknown';

	return {
		id: vm.id,
		name: vm.name,
		liveLoaded,
		vcpu: vm.live?.cores ?? vm.vmType?.cores ?? 0,
		ram: formatBytes(vm.live?.memory ?? (vm.vmType?.ramCapacity ?? 0) * 1024 * 1024),
		disk: formatBytes(vm.live?.disk ?? (vm.vmType?.storageAmount ?? 0) * 1024 * 1024 * 1024),
		ip: getFirstIp(
			vm.live?.networkInterfaces,
			(address) => !(address.startsWith('127.') || address.includes(':'))
		),
		ipv6: getFirstIp(vm.live?.networkInterfaces, (address) => address.includes(':')),
		status: resolveServerStatus(vm),
		agentConnected: vm.live?.status === 'running',
		region: 'Chicago',
		created: vm.creationDate,
		uptime: formatUptime(vm.live?.uptime ?? 0),
		plan: vm.vmType?.name ?? 'Custom',
		backups: false,
		metrics: vm.live?.metrics ?? null
	};
}
