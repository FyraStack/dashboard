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
	},
	customImages: {
		// Proxmox storage that holds project images. Must be shared across nodes,
		// support only the "import" content type, and hold nothing else.
		defaultProxmoxStorage: 'stack-user-images',
		maxImagesPerProject: 5,
		maxImageBytes: 50 * 1024 ** 3,
		maxProjectBytes: 100 * 1024 ** 3,
		// Upper bound on a qcow2's virtual disk size, independent of the plan.
		maxVirtualSizeBytes: 2 * 1024 ** 4,
		// Proxmox download tasks running longer than this are marked failed.
		importTimeoutMs: 6 * 60 * 60 * 1000,
		urlCheckTimeoutMs: 15_000,
		maxRedirects: 5,
		// Extra CIDRs import URLs may never resolve to, on top of the built-in
		// private/reserved ranges. Add infrastructure that lives on public IPs here
		// (Proxmox/VyOS management addresses, internal services, etc.).
		blockedPrefixes: [] as string[]
	}
};
