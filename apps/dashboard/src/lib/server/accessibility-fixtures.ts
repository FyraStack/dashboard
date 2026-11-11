import type {
	Account,
	Admin,
	AdminEmails,
	AdminIpam,
	AdminProjects,
	AdminUsers,
	AdminVms,
	Caller,
	Project,
	Projects,
	Vm
} from 'stack-backend';
import type { AppSession, AppUser } from 'stack-backend/types';
import { encodeHttpError } from 'stack-shared/http-error';

export const accessibilityFixtureProjectId = 'accessibility-project';
export const accessibilityFixtureServerId = 'accessibility-server';

type Resolved<T extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<T>>;

const now = new Date('2026-01-01T00:00:00.000Z');

const user: AppUser = {
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

const session: AppSession = {
	id: 'accessibility-session',
	userId: user.id,
	token: 'accessibility-session-token',
	expiresAt: new Date('2027-01-01T00:00:00.000Z'),
	createdAt: now,
	updatedAt: now,
	ipAddress: null,
	userAgent: null,
	activeOrganizationId: accessibilityFixtureProjectId
};

const featureFlags: Resolved<Admin['layout']>['featureFlags'] = {
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

const projectSummary: Resolved<Projects['list']>[number] = {
	id: accessibilityFixtureProjectId,
	projectName: 'Accessibility Project',
	ownerUserId: user.id,
	creationDate: now.getTime(),
	role: 'owner'
};

const projectDetails: Resolved<Project['get']> = {
	id: projectSummary.id,
	projectName: projectSummary.projectName,
	ownerUserId: user.id,
	ownerName: user.name,
	ownerEmail: user.email,
	creationDate: projectSummary.creationDate,
	members: [
		{
			userId: 'accessibility-member',
			name: 'Fixture Member',
			email: 'member@example.com',
			permissions: 'read_write'
		}
	]
};

const serverProxmoxId = 1001;
const serverProxmoxNode = 'fixture-node';
const serverIpv4 = '192.0.2.10';
const serverIpv6 = '2001:db8::10';

type Server = Resolved<Vm['get']>;

const vmType: NonNullable<Server['vmType']> = {
	name: 'Starter',
	cores: 2,
	ramCapacity: 4,
	storageAmount: 50
};

const live: NonNullable<Server['live']> & {
	metrics: NonNullable<NonNullable<Server['live']>['metrics']>;
	networkInterfaces: NonNullable<NonNullable<Server['live']>['networkInterfaces']>;
} = {
	id: 'a11y-server-01',
	proxmoxId: serverProxmoxId,
	proxmoxNode: serverProxmoxNode,
	name: 'a11y-server-01',
	status: 'running',
	cores: 2,
	memory: 4 * 1024 * 1024 * 1024,
	disk: 50 * 1024 * 1024 * 1024,
	uptime: 86_400,
	networkInterfaces: {
		eth0: {
			ipAddresses: [serverIpv4, serverIpv6]
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
};

const server: Server = {
	id: accessibilityFixtureServerId,
	name: 'a11y-server-01',
	proxmoxId: serverProxmoxId,
	active: true,
	ownerProjectId: projectSummary.id,
	vmTypeId: 'starter',
	creationDate: '2026-01-01T00:00:00.000Z',
	status: 'ready',
	vmType,
	live
};

const billing: Extract<Resolved<Project['billingPage']>, { kind: 'page' }>['billing'] = {
	setupRequired: false,
	activeResourceCount: 1,
	activeResources: [
		{
			id: 'starter',
			label: 'Starter',
			resourceType: 'vm',
			count: 1,
			hours: 720,
			cost: 36.0
		}
	],
	credits: {
		remaining: 2500,
		estimatedOverageCost: 0,
		prepaidPrice: { amount: 10, billingUnits: 1000 }
	},
	invoices: []
};

const adminUsers: Resolved<AdminUsers['list']> = [
	{
		id: user.id,
		name: user.name,
		email: user.email,
		image: null,
		emailVerified: user.emailVerified,
		role: 'admin',
		isAdmin: true,
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

const adminProjects: Resolved<AdminProjects['list']> = [
	{
		id: projectSummary.id,
		name: projectSummary.projectName,
		slug: 'accessibility-project',
		createdAt: now.getTime(),
		ownerId: user.id,
		ownerName: user.name,
		ownerEmail: user.email,
		ownerBillingExempt: false,
		memberCount: 2,
		vmCount: 1,
		volumeCount: 0,
		billingStatus: 'configured',
		billingExempt: false,
		disabled: false
	}
];

const adminVms: Resolved<AdminVms['list']> = [
	{
		id: server.id,
		name: server.name,
		proxmoxId: serverProxmoxId,
		proxmoxNode: serverProxmoxNode,
		active: server.active,
		status: server.status,
		statusError: null,
		liveStatus: live.status,
		uptime: live.uptime,
		cpuUsage: live.metrics.cpu ?? null,
		memoryUsageBytes: live.memory,
		memoryTotalBytes: live.memory,
		createdAt: now.getTime(),
		deletedAt: null,
		lastKnownAt: now.getTime(),
		lastKnownIpv4: serverIpv4,
		lastKnownIpv6: serverIpv6,
		projectId: projectSummary.id,
		projectName: projectSummary.projectName,
		projectBillingExempt: false,
		ownerName: user.name,
		ownerEmail: user.email,
		ownerBillingExempt: false,
		vmTypeName: vmType.name,
		vmTypeCores: vmType.cores,
		vmTypeRamCapacity: vmType.ramCapacity,
		vmTypeStorageAmount: vmType.storageAmount,
		vmTypeRate: '0.05'
	}
];

const ipamPrefixes: Resolved<AdminIpam['listPrefixes']> = [
	{
		id: 'accessibility-prefix-v4',
		name: 'Test IPv4',
		cidr: '192.0.2.0/24',
		family: 'ipv4',
		createdAt: now.getTime(),
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

const vmTypes: Resolved<Caller['listVmTypes']> = [
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

const images: Resolved<Caller['listImages']> = [
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

const campaignCatalog: Resolved<AdminEmails['templates']> = {
	batchSize: 25,
	templates: [
		{
			key: 'billing-notice',
			label: 'Billing notice',
			description: 'General notice with a heading, body text, and an action button.',
			defaultSubject: 'A notice about your Stack account',
			fields: [
				{
					name: 'userName',
					label: 'Recipient name',
					inline: true,
					required: false,
					placeholder: '{{name}}',
					defaultValue: '{{name}}'
				},
				{
					name: 'heading',
					label: 'Heading',
					inline: true,
					required: true,
					placeholder: 'Heading',
					defaultValue: 'A notice about your account'
				},
				{
					name: 'preview',
					label: 'Preview text',
					inline: false,
					required: true,
					placeholder: 'Shown in inbox previews',
					defaultValue: 'A notice about your Stack account'
				},
				{
					name: 'body',
					label: 'Body',
					inline: true,
					required: true,
					placeholder: 'Body',
					defaultValue: 'We wanted to let you know about an update to your account.'
				},
				{
					name: 'actionUrl',
					label: 'Button URL',
					inline: false,
					required: true,
					placeholder: 'https://stack.wtf/billing',
					defaultValue: 'https://stack.wtf/billing'
				},
				{
					name: 'actionLabel',
					label: 'Button label',
					inline: true,
					required: true,
					placeholder: 'Button label',
					defaultValue: 'View billing'
				}
			]
		}
	]
};

const campaignEditorHtml = [
	'<h1>[[FIELD:heading]]</h1>',
	'<p>Hi [[FIELD:userName]],</p>',
	'<p>[[FIELD:body]]</p>',
	'<p><a href="https://stack.wtf/billing">[[FIELD:actionLabel]]</a></p>'
].join('');

function notFound(what: string): never {
	throw encodeHttpError({ status: 404, message: `${what} not found` });
}

function strict<T extends object>(path: string, implemented: T): T {
	return new Proxy(implemented, {
		get(target, key, receiver) {
			if (typeof key === 'symbol' || key === 'then' || key in target) {
				return Reflect.get(target, key, receiver);
			}
			return () => {
				throw new Error(`Fixture backend does not implement ${path}.${key}`);
			};
		}
	});
}

function fixtureProject(projectId: string) {
	const methods: Pick<Project, 'get' | 'billingPage' | 'listVms' | 'listVmStatuses'> = {
		get: async () => (projectId === projectSummary.id ? projectDetails : notFound('Project')),
		billingPage: async () => ({
			kind: 'page',
			projectId,
			canManageBilling: true,
			billing
		}),
		listVms: async () => [server],
		listVmStatuses: async () => [
			{
				id: server.id,
				status: 'running',
				liveStatus: live.status,
				uptime: live.uptime,
				memory: live.memory,
				disk: live.disk,
				networkInterfaces: live.networkInterfaces,
				metrics: live.metrics
			}
		]
	};
	return strict('project', methods);
}

function fixtureVm(vmId: string) {
	const methods: Pick<Vm, 'get' | 'metricsHistory'> = {
		get: async () => (vmId === server.id ? server : notFound(`VM "${vmId}"`)),
		metricsHistory: async () => [
			{ time: Date.now() - 120_000, cpu: 0.18, memory: 0.41, bandwidth: 2048, diskIo: 256 },
			{ time: Date.now() - 60_000, cpu: 0.2, memory: 0.42, bandwidth: 4096, diskIo: 512 }
		]
	};
	return strict('vm', methods);
}

function fixtureAdmin() {
	const layout: Pick<Admin, 'layout'> = { layout: async () => ({ featureFlags }) };
	const users: Pick<AdminUsers, 'list'> = { list: async () => adminUsers };
	const projects: Pick<AdminProjects, 'list'> = { list: async () => adminProjects };
	const vms: Pick<AdminVms, 'list'> = { list: async () => adminVms };
	const ipam: Pick<AdminIpam, 'listPrefixes' | 'ptrDefaultFormats'> = {
		listPrefixes: async () => ipamPrefixes,
		ptrDefaultFormats: async () => ({ defaultPtrFormatIpv4: '', defaultPtrFormatIpv6: '' })
	};
	const emails: Pick<AdminEmails, 'templates' | 'renderEditor'> = {
		templates: async () => campaignCatalog,
		renderEditor: async () => ({ html: campaignEditorHtml })
	};
	return strict('admin', {
		...layout,
		users: () => strict('admin.users', users),
		projects: () => strict('admin.projects', projects),
		vms: () => strict('admin.vms', vms),
		ipam: () => strict('admin.ipam', ipam),
		emails: () => strict('admin.emails', emails)
	});
}

export function createFixtureCaller() {
	const account: Pick<Account, 'appLayout'> = {
		appLayout: async () => ({
			isAdmin: true,
			featureFlags,
			announcementsEnabled: true,
			unreadAnnouncements: []
		})
	};
	const projects: Pick<Projects, 'list'> = { list: async () => [projectSummary] };
	const root: Pick<Caller, 'release' | 'session' | 'listImages' | 'listVmTypes'> = {
		release: () => undefined,
		session: async () => ({ current: { session, user }, setCookie: [] }),
		listImages: async () => images,
		listVmTypes: async () => vmTypes
	};
	return strict('caller', {
		...root,
		account: () => strict('account', account),
		projects: () => strict('projects', projects),
		project: fixtureProject,
		vm: fixtureVm,
		admin: fixtureAdmin
	});
}
