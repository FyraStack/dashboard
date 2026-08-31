import type { FeatureFlags } from '$lib/feature-flags';

export const accessibilityFixtureEnabled = process.env['ACCESSIBILITY_FIXTURES'] === '1';

const now = new Date('2026-01-01T00:00:00.000Z');

export const accessibilityFixtureProject = {
	id: 'accessibility-project',
	projectName: 'Accessibility Project',
	ownerUserId: 'accessibility-user',
	creationDate: now.getTime(),
	role: 'owner' as const
};

export const accessibilityFixtureUser = {
	id: 'accessibility-user',
	name: 'Accessibility Tester',
	email: 'accessibility@example.com',
	emailVerified: true,
	image: null,
	createdAt: now,
	updatedAt: now,
	role: 'admin',
	isAdmin: true
};

export const accessibilityFixtureSession = {
	id: 'accessibility-session',
	userId: accessibilityFixtureUser.id,
	token: 'accessibility-session-token',
	expiresAt: new Date('2027-01-01T00:00:00.000Z'),
	createdAt: now,
	updatedAt: now,
	ipAddress: null,
	userAgent: null,
	activeOrganizationId: accessibilityFixtureProject.id
};

export const accessibilityFixtureFeatureFlags: FeatureFlags = {
	colocation: false,
	firewall: false,
	images: false,
	volumes: false,
	vpsConsole: false,
	vpsLogs: false,
	vpsNetworking: false,
	vpsImages: false,
	vpsSnapshots: false,
	vpsBackups: false,
	vpsRebuild: false,
	vpsResize: false,
	vpsRescue: false,
	vpsSettings: true
};

export const accessibilityFixtureProjects = [accessibilityFixtureProject];

export const accessibilityFixtureProjectDetails = {
	id: accessibilityFixtureProject.id,
	projectName: accessibilityFixtureProject.projectName,
	ownerUserId: accessibilityFixtureUser.id,
	ownerName: accessibilityFixtureUser.name,
	ownerEmail: accessibilityFixtureUser.email,
	creationDate: accessibilityFixtureProject.creationDate,
	members: [
		{
			userId: 'accessibility-member',
			name: 'Fixture Member',
			email: 'member@example.com',
			permissions: 'read_write' as const
		}
	]
};

export const accessibilityFixtureServers = [
	{
		id: 'accessibility-server',
		name: 'a11y-server-01',
		proxmoxId: 1001,
		active: true,
		ownerProjectId: accessibilityFixtureProject.id,
		vmTypeId: 'starter',
		creationDate: '2026-01-01T00:00:00.000Z',
		backend: 'proxmox' as const,
		status: 'ready' as const,
		vmType: {
			name: 'Starter',
			cores: 2,
			ramCapacity: 4,
			storageAmount: 50
		},
		live: {
			id: 'a11y-server-01',
			proxmoxId: 1001,
			proxmoxNode: 'fixture-node',
			name: 'a11y-server-01',
			status: 'running' as const,
			cores: 2,
			memory: 4 * 1024 * 1024 * 1024,
			disk: 50 * 1024 * 1024 * 1024,
			uptime: 86_400,
			networkInterfaces: {
				eth0: {
					ipAddresses: ['192.0.2.10', '2001:db8::10']
				}
			},
			metrics: {
				cpu: 18,
				memory: 42,
				disk: 33,
				networkIn: 1024,
				networkOut: 2048,
				diskRead: 512,
				diskWrite: 256
			}
		}
	}
];

export const accessibilityFixtureBillingOverview = {
	customer: null,
	status: 'active' as const,
	statusLabel: 'Ready',
	planLabel: 'Project billing',
	setupRequired: false,
	syncError: null,
	lastUpdatedAt: now.getTime(),
	activeResourceCount: 1,
	activeResources: [
		{
			id: 'starter',
			label: 'Starter',
			resourceType: 'vm' as const,
			count: 1,
			hours: 720,
			cost: 36.0
		}
	],
	invoices: []
};

export const accessibilityFixtureAdminUsers = [
	{
		id: accessibilityFixtureUser.id,
		name: accessibilityFixtureUser.name,
		email: accessibilityFixtureUser.email,
		image: accessibilityFixtureUser.image,
		emailVerified: accessibilityFixtureUser.emailVerified,
		role: accessibilityFixtureUser.role,
		isAdmin: accessibilityFixtureUser.isAdmin,
		disabled: false,
		billingExempt: false,
		twoFactorEnabled: false,
		createdAt: now,
		updatedAt: now,
		sessionCount: 1,
		accountCount: 1,
		orgCount: 1,
		sshKeyCount: 0,
		apiTokenCount: 0,
		passkeyCount: 0
	}
];

export const accessibilityFixtureAdminProjects = [
	{
		id: accessibilityFixtureProject.id,
		name: accessibilityFixtureProject.projectName,
		slug: 'accessibility-project',
		createdAt: now.getTime(),
		ownerId: accessibilityFixtureUser.id,
		ownerName: accessibilityFixtureUser.name,
		ownerEmail: accessibilityFixtureUser.email,
		ownerBillingExempt: false,
		memberCount: 2,
		vmCount: 1,
		volumeCount: 0,
		billingStatus: 'configured' as const,
		billingExempt: false,
		disabled: false
	}
];

export const accessibilityFixtureAdminVms = [
	{
		id: accessibilityFixtureServers[0].id,
		name: accessibilityFixtureServers[0].name,
		proxmoxId: accessibilityFixtureServers[0].proxmoxId,
		proxmoxNode: accessibilityFixtureServers[0].live.proxmoxNode,
		active: accessibilityFixtureServers[0].active,
		status: accessibilityFixtureServers[0].status,
		statusError: null,
		liveStatus: accessibilityFixtureServers[0].live.status,
		uptime: accessibilityFixtureServers[0].live.uptime,
		cpuUsage: accessibilityFixtureServers[0].live.metrics.cpu,
		memoryUsageBytes: accessibilityFixtureServers[0].live.memory,
		memoryTotalBytes: accessibilityFixtureServers[0].live.memory,
		createdAt: now.getTime(),
		deletedAt: null,
		lastKnownAt: now.getTime(),
		lastKnownIpv4: accessibilityFixtureServers[0].live.networkInterfaces.eth0.ipAddresses[0],
		lastKnownIpv6: accessibilityFixtureServers[0].live.networkInterfaces.eth0.ipAddresses[1],
		projectId: accessibilityFixtureProject.id,
		projectName: accessibilityFixtureProject.projectName,
		projectBillingExempt: false,
		ownerName: accessibilityFixtureUser.name,
		ownerEmail: accessibilityFixtureUser.email,
		ownerBillingExempt: false,
		vmTypeName: accessibilityFixtureServers[0].vmType.name,
		vmTypeCores: accessibilityFixtureServers[0].vmType.cores,
		vmTypeRamCapacity: accessibilityFixtureServers[0].vmType.ramCapacity,
		vmTypeStorageAmount: accessibilityFixtureServers[0].vmType.storageAmount,
		vmTypeRate: '0.05'
	}
];

export const accessibilityFixtureIpamPrefixes = [
	{
		id: 'accessibility-prefix-v4',
		name: 'Test IPv4',
		cidr: '192.0.2.0/24',
		family: 'ipv4' as const,
		disabled: false,
		ipv6UseTransitAddress: false,
		whitelistStart: null,
		whitelistEnd: null,
		gatewayAddress: '192.0.2.1',
		bunnyDnsZone: null,
		allocated: 2,
		capacity: '254',
		available: '252',
		hasCapacity: true
	}
];

export const accessibilityFixtureVmTypes = [
	{
		id: 'starter',
		name: 'Starter',
		isa: 'x86',
		cores: 2,
		ramCapacity: 4,
		storageAmount: 50,
		rate: '0.05',
		cap: '50.00',
		autumnFeatureId: 'starter'
	}
];

export const accessibilityFixtureImages = [
	{
		id: 'ubuntu-2404',
		name: 'Ubuntu',
		version: '24.04 LTS',
		description: 'Ubuntu 24.04 LTS',
		icon: 'ubuntu',
		color: 'bg-orange-500',
		isOfficial: true,
		logoSvg: null,
		accentColor: '#E95420',
		imageType: 'qcow2',
		secureBoot: false,
		filePath: 'local:iso/ubuntu-24.04.qcow2',
		isa: 'x86'
	}
];
