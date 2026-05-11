import { getRuntimeEnv } from '$lib/server/env';

type NetboxMethod = 'DELETE' | 'PATCH' | 'POST';

type NetboxCreateResult = {
	netbox_vm_id: number;
	netbox_vm_interface_id: number;
	netbox_mac_address_id: number;
	netbox_ip_address_ids: number[];
};

type NetboxVm = { id: number };
type NetboxVmInterface = { id: number };
type NetboxMacAddress = { id: number };
type NetboxIpAddress = { id: number };

export class NetboxError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly details: unknown
	) {
		super(message);
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

	return {
		apiToken: env.NETBOX_API_TOKEN,
		apiUrl: env.NETBOX_API_URL.replace(/\/+$/, '')
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
		throw new NetboxError(`Netbox ${method} ${route} failed`, response.status, body);
	}

	return body as T;
}

export async function assignIPToVM(netbox_vm_interface_id: number, ip_address: string) {
	return await netbox<NetboxIpAddress>('/api/ipam/ip-addresses/', 'POST', {
		address: ip_address,
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: netbox_vm_interface_id
	});
}

export async function deleteIP(netbox_ip_address_id: number) {
	return await netbox(`/api/ipam/ip-addresses/${netbox_ip_address_id}/`, 'DELETE');
}

async function assignMACToVM(mac_address: string, vm_interface_id: number) {
	const mac_address_create = await netbox<NetboxMacAddress>('/api/dcim/mac-addresses/', 'POST', {
		mac_address: mac_address,
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: vm_interface_id
	});
	if (!mac_address_create) return null;

	await netbox('/api/virtualization/interfaces/', 'PATCH', [
		{
			id: vm_interface_id,
			primary_mac_address: mac_address_create.id
		}
	]);

	return mac_address_create.id;
}

export async function createVMandAssignIPs(
	vmid: string,
	mac_address: string,
	ip_addresses: string[]
): Promise<NetboxCreateResult | null> {
	const vm_create = await netbox<NetboxVm>('/api/virtualization/virtual-machines/', 'POST', {
		name: vmid,
		status: 'offline',
		site: 1,
		cluster: 1,
		vcpus: 2,
		memory: 8,
		disk: 60,
		description: 'should work'
	});
	if (!vm_create) return null;

	const vm_interface_create = await netbox<NetboxVmInterface>(
		'/api/virtualization/interfaces/',
		'POST',
		{
			virtual_machine: vm_create.id,
			name: 'interface1'
		}
	);
	if (!vm_interface_create) return null;

	const promises: Promise<number | NetboxIpAddress | null>[] = [];

	promises.push(assignMACToVM(mac_address, vm_interface_create.id));

	for (const ip_address of ip_addresses) {
		promises.push(assignIPToVM(vm_interface_create.id, ip_address));
	}

	const assigned_ids = await Promise.all(promises);

	const mac_address_id = assigned_ids.shift();
	if (typeof mac_address_id !== 'number') {
		throw new NetboxError('Netbox MAC assignment did not return an ID', 502, mac_address_id);
	}

	return {
		netbox_vm_id: vm_create.id,
		netbox_vm_interface_id: vm_interface_create.id,
		netbox_mac_address_id: mac_address_id,
		netbox_ip_address_ids: assigned_ids.flatMap((assignment) =>
			assignment && typeof assignment === 'object' ? [assignment.id] : []
		)
	};
}

export async function deleteVM(
	netbox_vm_id: number,
	netbox_vm_interface_id: number,
	netbox_mac_address_id: number
) {
	const promises = [];

	promises.push(netbox(`/api/virtualization/virtual-machines/${netbox_vm_id}/`, 'DELETE'));
	promises.push(netbox(`/api/virtualization/interfaces/${netbox_vm_interface_id}/`, 'DELETE'));
	promises.push(netbox(`/api/dcim/mac-addresses/${netbox_mac_address_id}/`, 'DELETE'));

	await Promise.all(promises);
}
