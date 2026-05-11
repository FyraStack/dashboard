import { getRuntimeEnv } from '$lib/server/env';

type NetboxMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST';

type NetboxCreateResult = {
	netbox_vm_id: number;
	netbox_vm_interface_id: number;
	netbox_mac_address_id: number;
	netbox_ip_address_ids: number[];
	netbox_primary_ipv4_id: number;
	netbox_primary_ipv6_id: number;
	primary_ipv4: string;
	primary_ipv6: string;
};

type NetboxVm = { id: number };
type NetboxVmInterface = { id: number };
type NetboxMacAddress = { id: number };
type NetboxIpAddress = { id: number; address: string };
type NetboxAvailablePrefix = { prefix: string };
type NetboxPrefix = { id: number; prefix: string };

type CreateNetboxVmParams = {
	name: string;
	macAddress: string;
	ipAddresses: string[];
	vcpus: number;
	memoryMb: number;
	diskGb: number;
	description?: string;
};

type NetboxAllocationConfig = {
	ipv4PrefixId: number;
	ipv6PrefixId: number;
	ipv6PrefixLength: number;
};

export class NetboxError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly details: unknown
	) {
		let details_string;
		try {
			details_string = JSON.stringify(details);
		} catch {
			details_string = 'Unable to stringify details';
		}

		super(`${message} - ${status} - ${details_string}`);
		this.name = 'NetboxError';
	}
}

export function isNetboxConfigured() {
	const env = getRuntimeEnv();
	return Boolean(env.NETBOX_API_TOKEN && env.NETBOX_API_URL);
}

async function parseResponse(response: Response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function getNetboxConfig() {
	const env = getRuntimeEnv();
	if (!env.NETBOX_API_TOKEN || !env.NETBOX_API_URL) return null;
	const siteId = env.NETBOX_SITE_ID ? Number.parseInt(env.NETBOX_SITE_ID, 10) : null;
	const clusterId = env.NETBOX_CLUSTER_ID ? Number.parseInt(env.NETBOX_CLUSTER_ID, 10) : null;

	if (siteId === null && clusterId === null) {
		throw new NetboxError('NETBOX_SITE_ID or NETBOX_CLUSTER_ID is required', 500, null);
	}
	if (siteId !== null && Number.isNaN(siteId)) {
		throw new NetboxError('NETBOX_SITE_ID must be a number', 500, env.NETBOX_SITE_ID);
	}
	if (clusterId !== null && Number.isNaN(clusterId)) {
		throw new NetboxError('NETBOX_CLUSTER_ID must be a number', 500, env.NETBOX_CLUSTER_ID);
	}

	return {
		apiToken: env.NETBOX_API_TOKEN,
		apiUrl: env.NETBOX_API_URL.replace(/\/+$/, ''),
		siteId,
		clusterId
	};
}

function parseRequiredNumber(
	name: keyof ReturnType<typeof getRuntimeEnv>,
	value: string | undefined
) {
	if (!value) throw new NetboxError(`${name} is required`, 500, null);
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed)) throw new NetboxError(`${name} must be a number`, 500, value);

	return parsed;
}

function getNetboxAllocationConfig(): NetboxAllocationConfig | null {
	if (!getNetboxConfig()) return null;
	const env = getRuntimeEnv();

	return {
		ipv4PrefixId: parseRequiredNumber('NETBOX_IPV4_PREFIX_ID', env.NETBOX_IPV4_PREFIX_ID),
		ipv6PrefixId: parseRequiredNumber('NETBOX_IPV6_PREFIX_ID', env.NETBOX_IPV6_PREFIX_ID),
		ipv6PrefixLength: parseRequiredNumber(
			'NETBOX_IPV6_PREFIX_LENGTH',
			env.NETBOX_IPV6_PREFIX_LENGTH
		)
	};
}

async function netbox<T>(route: string, method: NetboxMethod, data?: unknown): Promise<T | null> {
	const config = getNetboxConfig();
	if (!config) return null;

	const response = await fetch(`${config.apiUrl}${route}`, {
		headers: {
			Authorization: `Bearer ${config.apiToken}`,
			'Content-Type': 'application/json'
		},
		method,
		...(data === undefined ? {} : { body: JSON.stringify(data) })
	});

	const body = await parseResponse(response);
	if (!response.ok) {
		console.error(data);
		throw new NetboxError(`Netbox ${method} ${route} failed`, response.status, body);
	}

	return body as T;
}

export async function assignIPToVM(netbox_vm_interface_id: number, ip_address: string) {
	return await netbox<NetboxIpAddress>('/api/ipam/ip-addresses/', 'POST', {
		address: ip_address,
		status: 'active',
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: netbox_vm_interface_id
	});
}

export async function deleteIP(netbox_ip_address_id: number) {
	return await netbox(`/api/ipam/ip-addresses/${netbox_ip_address_id}/`, 'DELETE');
}

async function assignAvailableIPv4(netbox_vm_interface_id: number) {
	const allocation = getNetboxAllocationConfig();
	if (!allocation) return null;

	const [ip] =
		(await netbox<NetboxIpAddress[]>(
			`/api/ipam/prefixes/${allocation.ipv4PrefixId}/available-ips/`,
			'POST',
			[
				{
					prefix_length: 32,
					status: 'active',
					assigned_object_type: 'virtualization.vminterface',
					assigned_object_id: netbox_vm_interface_id
				}
			]
		)) ?? [];
	if (!ip) throw new NetboxError('NetBox did not allocate an IPv4 address', 502, null);

	return ip;
}

async function assignAvailableIPv6(netbox_vm_interface_id: number) {
	const allocation = getNetboxAllocationConfig();
	if (!allocation) return null;

	const [ip] =
		(await netbox<NetboxIpAddress[]>(
			`/api/ipam/prefixes/${allocation.ipv6PrefixId}/available-ips/`,
			'POST',
			[
				{
					prefix_length: allocation.ipv6PrefixLength,
					status: 'active',
					assigned_object_type: 'virtualization.vminterface',
					assigned_object_id: netbox_vm_interface_id
				}
			]
		)) ?? [];

	if (!ip) throw new NetboxError('NetBox did not create an IPv6 address', 502, null);

	return ip;
}

async function setVMPrimaryIPs(netbox_vm_id: number, primary_ip4: number, primary_ip6: number) {
	await netbox(`/api/virtualization/virtual-machines/${netbox_vm_id}/`, 'PATCH', {
		primary_ip4,
		primary_ip6
	});
}

export async function clearVMPrimaryIPs(netbox_vm_id: number) {
	await netbox(`/api/virtualization/virtual-machines/${netbox_vm_id}/`, 'PATCH', {
		primary_ip4: null,
		primary_ip6: null
	});
}

async function assignMACToVM(mac_address: string, vm_interface_id: number) {
	const mac_address_create = await netbox<NetboxMacAddress>('/api/dcim/mac-addresses/', 'POST', {
		mac_address: mac_address,
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: vm_interface_id
	});
	if (!mac_address_create) return null;

	await netbox(`/api/virtualization/interfaces/${vm_interface_id}/`, 'PATCH', {
		primary_mac_address: mac_address_create.id
	});

	return mac_address_create.id;
}

export async function createVMandAssignIPs({
	name,
	macAddress,
	ipAddresses,
	vcpus,
	memoryMb,
	diskGb,
	description
}: CreateNetboxVmParams): Promise<NetboxCreateResult | null> {
	const config = getNetboxConfig();
	if (!config) return null;
	let vm_create: NetboxVm | null = null;
	let vm_interface_create: NetboxVmInterface | null = null;
	let mac_address_id: number | null = null;
	const netbox_ip_address_ids: number[] = [];

	try {
		vm_create = await netbox<NetboxVm>('/api/virtualization/virtual-machines/', 'POST', {
			name,
			status: 'offline',
			...(config.siteId === null ? {} : { site: config.siteId }),
			...(config.clusterId === null ? {} : { cluster: config.clusterId }),
			vcpus,
			memory: memoryMb,
			disk: diskGb,
			...(description ? { description } : {})
		});
		if (!vm_create) return null;

		vm_interface_create = await netbox<NetboxVmInterface>(
			'/api/virtualization/interfaces/',
			'POST',
			{
				virtual_machine: vm_create.id,
				name: 'interface1'
			}
		);
		if (!vm_interface_create) return null;

		const promises: Promise<number | NetboxIpAddress | null>[] = [];

		promises.push(assignMACToVM(macAddress, vm_interface_create.id));

		for (const ip_address of ipAddresses) {
			promises.push(assignIPToVM(vm_interface_create.id, ip_address));
		}

		const assigned_ids = await Promise.all(promises);

		const assigned_mac_address_id = assigned_ids.shift();
		if (typeof assigned_mac_address_id !== 'number') {
			throw new NetboxError(
				'Netbox MAC assignment did not return an ID',
				502,
				assigned_mac_address_id
			);
		}
		mac_address_id = assigned_mac_address_id;
		netbox_ip_address_ids.push(
			...assigned_ids.flatMap((assignment) =>
				assignment && typeof assignment === 'object' ? [assignment.id] : []
			)
		);

		const ipv4 = await assignAvailableIPv4(vm_interface_create.id);
		if (!ipv4) throw new NetboxError('NetBox did not allocate IPv4 networking', 502, null);
		netbox_ip_address_ids.push(ipv4.id);
		const ipv6 = await assignAvailableIPv6(vm_interface_create.id);
		if (!ipv6) throw new NetboxError('NetBox did not allocate IPv6 networking', 502, null);
		netbox_ip_address_ids.push(ipv6.id);
		await setVMPrimaryIPs(vm_create.id, ipv4.id, ipv6.id);

		return {
			netbox_vm_id: vm_create.id,
			netbox_vm_interface_id: vm_interface_create.id,
			netbox_mac_address_id: mac_address_id,
			netbox_ip_address_ids,
			netbox_primary_ipv4_id: ipv4.id,
			netbox_primary_ipv6_id: ipv6.id,
			primary_ipv4: ipv4.address,
			primary_ipv6: ipv6.address
		};
	} catch (err) {
		if (vm_create) await clearVMPrimaryIPs(vm_create.id).catch(() => {});
		await Promise.all(
			netbox_ip_address_ids.map((netbox_ip_address_id) =>
				deleteIP(netbox_ip_address_id).catch(() => {})
			)
		);
		if (vm_interface_create) {
			await netbox(`/api/virtualization/interfaces/${vm_interface_create.id}/`, 'PATCH', {
				primary_mac_address: null
			}).catch(() => {});
		}
		if (mac_address_id != null) {
			await netbox(`/api/dcim/mac-addresses/${mac_address_id}/`, 'DELETE').catch(() => {});
		}
		if (vm_interface_create) {
			await netbox(`/api/virtualization/interfaces/${vm_interface_create.id}/`, 'DELETE').catch(
				() => {}
			);
		}
		if (vm_create) {
			await netbox(`/api/virtualization/virtual-machines/${vm_create.id}/`, 'DELETE').catch(
				() => {}
			);
		}
		throw err;
	}
}

export async function deleteVM(
	netbox_vm_id: number,
	netbox_vm_interface_id: number,
	netbox_mac_address_id: number
) {
	await netbox(`/api/virtualization/interfaces/${netbox_vm_interface_id}/`, 'PATCH', {
		primary_mac_address: null
	});
	await netbox(`/api/dcim/mac-addresses/${netbox_mac_address_id}/`, 'DELETE');
	await netbox(`/api/virtualization/interfaces/${netbox_vm_interface_id}/`, 'DELETE');
	await netbox(`/api/virtualization/virtual-machines/${netbox_vm_id}/`, 'DELETE');
}
