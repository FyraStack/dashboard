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
	vpsConsole: true,
	vpsLogs: true,
	vpsNetworking: true,
	vpsImages: true,
	vpsSnapshots: true,
	vpsBackups: true,
	vpsRebuild: true,
	vpsResize: true,
	vpsRescue: true,
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
