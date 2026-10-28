export const config = {
	proxmox: {
		vmDiskStorage: 'stack-volumes',
		tenantPool: 'stack-tenants',
		vmBridge: 'public',
		vmNetRateMbps: 128
	},
	vmNetwork: {
		ipv6DefaultGateway: 'fe80::1040:ffff',
		nat64Prefix: '64:ff9b::/96',
		nat64Dns64Server: '2602:f41f:10:1040::ffff',
		nameservers: ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']
	}
};
