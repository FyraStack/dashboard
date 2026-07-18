type ServerStatus = 'running' | 'stopped' | 'restarting' | 'provisioning' | 'deleting' | 'unknown';

type VmSummary = {
	id: string;
	name: string;
	active: boolean;
	creationDate: string;
	status?: string | null;
	vmType: {
		name: string;
		cores: number;
		ramCapacity: number;
		storageAmount: number;
	} | null;
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
};

type NetworkInterfaces = NonNullable<NonNullable<VmSummary['live']>['networkInterfaces']>;
type ServerMetrics = {
	cpu?: number | null;
	memory?: number | null;
	disk?: number | null;
	networkIn?: number | null;
	networkOut?: number | null;
	diskRead?: number | null;
	diskWrite?: number | null;
};

export type ServerInfo = {
	id: string;
	name: string;
	liveLoaded: boolean;
	vcpu: number;
	ram: string;
	disk: string;
	ip: string;
	ipv6: string;
	status: ServerStatus;
	agentConnected: boolean;
	region: string;
	created: string;
	uptime: string;
	plan: string;
	backups: boolean;
	metrics: ServerMetrics | null;
};

function formatBytes(bytes: number): string {
	if (!bytes) return '0B';
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1) return `${gb.toFixed(0)}GB`;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)}MB`;
}

function formatUptime(seconds: number): string {
	if (!seconds) return '-';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${d}d ${h}h ${m}m`;
}

function getFirstIp(
	networkInterfaces: NetworkInterfaces | null | undefined,
	match: (address: string) => boolean
): string {
	if (!networkInterfaces) return '-';

	return (
		Object.values(networkInterfaces)
			.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
			.find((address) => address && match(address)) ?? '-'
	);
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
			(address) => !address.startsWith('127.') && !address.includes(':')
		),
		ipv6: getFirstIp(vm.live?.networkInterfaces, (address) => address.includes(':')),
		status:
			vm.status === 'deleting'
				? 'deleting'
				: vm.live?.status === 'running'
					? 'running'
					: vm.live?.status === 'paused'
						? 'restarting'
						: vm.status === 'provisioning'
							? 'provisioning'
							: vm.live?.status === 'stopped'
								? 'stopped'
								: 'unknown',
		agentConnected: vm.live?.status === 'running',
		region: 'Chicago',
		created: vm.creationDate,
		uptime: formatUptime(vm.live?.uptime ?? 0),
		plan: vm.vmType?.name ?? 'Custom',
		backups: false,
		metrics: vm.live?.metrics ?? null
	};
}
