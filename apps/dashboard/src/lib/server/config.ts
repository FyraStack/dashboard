export const config = {
	proxmox: {
		vmDiskStorage: 'stack-volumes',
		tenantPool: 'stack-tenants',
		vmBridge: 'public',
		vmNetRateMbps: 128
	},
	vmNetwork: {
		ipv6DefaultGateway: 'fe80::1040:ffff',
		nameservers: ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']
	}
};
