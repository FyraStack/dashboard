import { getRuntimeEnv } from '$lib/server/env';

/*
docs for how to get this working:

you need to make a site and cluster in the netbox webui
*/

async function netbox(route: String, method: String, data?: any) {
	const env = getRuntimeEnv();

	const apiToken = env.NETBOX_API_TOKEN;
	const netboxAPIURL = env.NETBOX_API_URL;

	const response = await fetch(`${netboxAPIURL}${route}`, {
		headers: {
			Authorization: `Bearer ${apiToken}`,
			'Content-Type': 'application/json'
		},
		method: method as string,
		body: JSON.stringify(data)
	});

	let res_body: any;
	try {
		res_body = await response.json();
	} catch {
		res_body = await response.text();
	}

	return res_body;
}

export async function assignIPToVM(netbox_vm_interface_id: Number, ip_address: String) {
	return await netbox('/api/ipam/ip-addresses/', 'POST', {
		address: ip_address,
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: netbox_vm_interface_id
	});
}

export async function deleteIP(netbox_ip_address_id: Number) {
	return await netbox(`/api/ipam/ip-addresses/${netbox_ip_address_id}/`, 'DELETE');
}

async function assignMACToVM(mac_address: String, vm_interface_id: Number) {
	let mac_address_create = await netbox('/api/dcim/mac-addresses/', 'POST', {
		mac_address: mac_address,
		assigned_object_type: 'virtualization.vminterface',
		assigned_object_id: vm_interface_id
	});

	console.log('mac_address_create');
	console.log(mac_address_create);

	let vm_interface_patch_add_mac = await netbox('/api/virtualization/interfaces/', 'PATCH', [
		{
			id: vm_interface_id,
			primary_mac_address: mac_address_create.id
		}
	]);

	console.log('vm_interface_patch_add_mac');
	console.log(vm_interface_patch_add_mac);

	return mac_address_create.id;
}

export async function createVMandAssignIPs(
	vmid: String,
	mac_address: String,
	ip_addresses: String[]
) {
	let vm_create = await netbox('/api/virtualization/virtual-machines/', 'POST', {
		name: vmid,
		status: 'offline',
		site: 1,
		cluster: 1,
		vcpus: 2,
		memory: 8,
		disk: 60,
		description: 'should work'
	});

	console.log('vm_create');
	console.log(vm_create);

	let vm_interface_create = await netbox('/api/virtualization/interfaces/', 'POST', {
		virtual_machine: vm_create.id,
		name: 'interface1'
	});

	console.log('vm_interface_create');
	console.log(vm_interface_create);

	const promises = [];

	promises.push(assignMACToVM(mac_address, vm_interface_create.id));

	for (const ip_address of ip_addresses) {
		promises.push(assignIPToVM(vm_interface_create.id, ip_address));
	}

	const ip_address_ids = await Promise.all(promises);

	const mac_address_id = ip_address_ids.shift();

	return {
		netbox_vm_id: vm_create.id,
		netbox_vm_interface_id: vm_interface_create.id,
		netbox_mac_address_id: mac_address_id,
		netbox_ip_address_ids: ip_address_ids
	};
}

export async function deleteVM(
	netbox_vm_id: Number,
	netbox_vm_interface_id: Number,
	netbox_mac_address_id: Number
) {
	const promises = [];

	promises.push(netbox(`/api/virtualization/virtual-machines/${netbox_vm_id}/`, 'DELETE'));
	promises.push(netbox(`/api/virtualization/interfaces/${netbox_vm_interface_id}/`, 'DELETE'));
	promises.push(netbox(`/api/dcim/mac-addresses/${netbox_mac_address_id}/`, 'DELETE'));

	await Promise.all(promises);
}
