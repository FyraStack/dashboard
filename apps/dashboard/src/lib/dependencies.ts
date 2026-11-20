const app = {
	featureFlags: 'app:feature-flags',
	ipamPrefixes: 'app:ipam-prefixes',
	projects: 'app:projects',
	sshKeys: 'app:ssh-keys'
} as const;

const project = {
	createServer: 'project:create-server',
	vms: 'project:vms',
	volumes: 'project:volumes'
} as const;

const support = {
	tickets: 'support:tickets'
} as const;

const admin = {
	announcements: 'app:admin-announcements',
	featureFlags: app.featureFlags,
	images: 'app:admin-images',
	ipamPrefixes: app.ipamPrefixes,
	projects: 'app:admin-projects',
	tickets: 'app:admin-tickets',
	users: 'app:admin-users',
	vmTypes: 'app:admin-vm-types',
	vms: 'app:admin-vms'
} as const;

export const dependencies = { admin, app, project, support } as const;
