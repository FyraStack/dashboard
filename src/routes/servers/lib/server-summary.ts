type ServerStatus = 'running' | 'stopped' | 'restarting' | 'provisioning';

type VmSummary = {
	id: string;
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
	} | null;
};

type NetworkInterfaces = NonNullable<NonNullable<VmSummary['live']>['networkInterfaces']>;

export type ServerInfo = {
	id: string;
	name: string;
	vcpu: number;
	ram: string;
	disk: string;
	ip: string;
	ipv6: string;
	status: ServerStatus;
	agentConnected: boolean;
	os: string;
	region: string;
	created: string;
	uptime: string;
	plan: string;
	backups: boolean;
};

function formatBytes(bytes: number): string {
	if (!bytes) return '0B';
	const gb = bytes / (1024 * 1024 * 1024);
	if (gb >= 1) return `${gb.toFixed(0)}GB`;
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(0)}MB`;
}

function formatUptime(seconds: number): string {
	if (!seconds) return '—';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${d}d ${h}h ${m}m`;
}

function getFirstIp(
	networkInterfaces: NetworkInterfaces | null | undefined,
	match: (address: string) => boolean
): string {
	if (!networkInterfaces) return '—';

	return (
		Object.values(networkInterfaces)
			.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
			.find((address) => address && match(address)) ?? '—'
	);
}

export function toServerInfo(vm: VmSummary): ServerInfo {
	return {
		id: vm.id,
		name: vm.live?.name ?? vm.id,
		vcpu: vm.live?.cores ?? vm.vmType?.cores ?? 0,
		ram: formatBytes(vm.live?.memory ?? (vm.vmType?.ramCapacity ?? 0) * 1024 * 1024),
		disk: formatBytes(vm.live?.disk ?? (vm.vmType?.storageAmount ?? 0) * 1024 * 1024 * 1024),
		ip: getFirstIp(
			vm.live?.networkInterfaces,
			(address) => !address.startsWith('127.') && !address.includes(':')
		),
		ipv6: getFirstIp(vm.live?.networkInterfaces, (address) => address.includes(':')),
		status:
			vm.status === 'provisioning'
				? 'provisioning'
				: ((vm.live?.status ?? 'stopped') as ServerStatus),
		agentConnected: vm.live?.status === 'running',
		os: vm.vmType?.name ?? 'Unknown',
		region: 'New York',
		created: vm.creationDate,
		uptime: formatUptime(vm.live?.uptime ?? 0),
		plan: vm.vmType?.name ?? 'Custom',
		backups: false
	};
}
