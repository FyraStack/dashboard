import { isLifecycleStatus, type ServerStatus, toServerStatus } from 'stack-shared/vm-status';
import { firstIpv4, firstIpv6, formatBytes, formatUptime } from '#lib/format.js';
import type { listVmStatuses, listVms } from '#lib/remote/vms.remote.js';

type VmSummary = Awaited<ReturnType<typeof listVms>>[number];
type VmStatus = Awaited<ReturnType<typeof listVmStatuses>>[number];

export interface ServerInfo {
	agentConnected: boolean;
	created: string;
	disk: string;
	id: string;
	ip: string | null;
	ipv6: string | null;
	liveLoaded: boolean;
	metrics: NonNullable<VmStatus['metrics']> | null;
	name: string;
	plan: string;
	ram: string;
	region: string;
	status: ServerStatus;
	uptime: string | null;
	vcpu: number;
}

type ServerLive = Pick<
	ServerInfo,
	'agentConnected' | 'ip' | 'ipv6' | 'metrics' | 'status' | 'uptime'
>;

export function primaryAddress(server: Pick<ServerInfo, 'ip' | 'ipv6'>): string | null {
	return server.ip ?? server.ipv6;
}

export function toServerInfo(vm: VmSummary): ServerInfo {
	const { live, vmType } = vm;
	return {
		id: vm.id,
		name: vm.name,
		liveLoaded: Boolean(live) && live?.status !== 'unknown',
		vcpu: live?.cores ?? vmType?.cores ?? 0,
		ram: formatBytes(live?.memory ?? (vmType?.ramCapacity ?? 0) * 1024 ** 2),
		disk: formatBytes(live?.disk ?? (vmType?.storageAmount ?? 0) * 1024 ** 3),
		region: 'Chicago',
		created: vm.creationDate,
		plan: vmType?.name ?? 'Custom',
		status: toServerStatus(vm.status, live?.status),
		agentConnected: live?.status === 'running',
		ip: firstIpv4(live?.networkInterfaces),
		ipv6: firstIpv6(live?.networkInterfaces),
		uptime: formatUptime(live?.uptime ?? 0),
		metrics: live?.metrics ?? null
	};
}

export function toServerLive(status: VmStatus): ServerLive {
	return {
		status: status.status,
		agentConnected: status.liveStatus === 'running',
		ip: firstIpv4(status.networkInterfaces),
		ipv6: firstIpv6(status.networkInterfaces),
		uptime: formatUptime(status.uptime),
		metrics: status.metrics ?? null
	};
}

export function mergeLive(server: ServerInfo, live: ServerLive): ServerInfo {
	return {
		...server,
		liveLoaded: true,
		status:
			server.status === 'restarting' && live.status !== 'running' ? 'restarting' : live.status,
		agentConnected: live.agentConnected,
		ip: live.ip ?? server.ip,
		ipv6: live.ipv6 ?? server.ipv6,
		uptime: live.uptime,
		metrics: live.metrics ?? server.metrics
	};
}

export function mergeListWithLive(listed: ServerInfo, current: ServerInfo): ServerInfo {
	return {
		...mergeLive(listed, current),
		status: isLifecycleStatus(listed.status) ? listed.status : current.status
	};
}
