export const featureFlagKeys = [
	'colocation',
	'firewall',
	'images',
	'volumes',
	'vpsConsole',
	'vpsLogs',
	'vpsNetworking',
	'vpsImages',
	'vpsSnapshots',
	'vpsBackups',
	'vpsRebuild',
	'vpsResize',
	'vpsRescue',
	'vpsSettings'
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const defaultFeatureFlags: FeatureFlags = {
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

export const developmentFeatureFlags: FeatureFlags = {
	colocation: true,
	firewall: true,
	images: true,
	volumes: true,
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

export const featureFlagLabels: Record<FeatureFlagKey, string> = {
	colocation: 'Colocation',
	firewall: 'Firewall',
	images: 'Images',
	volumes: 'Volumes',
	vpsConsole: 'Console Tab',
	vpsLogs: 'Logs Tab',
	vpsNetworking: 'Networking Tab',
	vpsImages: 'Images Tab',
	vpsSnapshots: 'Snapshots Tab',
	vpsBackups: 'Backups Tab',
	vpsRebuild: 'Rebuild Tab',
	vpsResize: 'Resize Tab',
	vpsRescue: 'Rescue Tab',
	vpsSettings: 'Settings Tab'
};

export const featureFlagDescriptions: Record<FeatureFlagKey, string> = {
	colocation: 'Enable colocation server management',
	firewall: 'Enable firewall rule management for projects',
	images: 'Enable custom image management and deployment',
	volumes: 'Enable persistent volume management',
	vpsConsole: 'Web-based serial console access for VPS instances',
	vpsLogs: 'System and service log viewing for VPS instances',
	vpsNetworking: 'IP allocation and network interface management',
	vpsImages: 'OS image selection and reinstallation',
	vpsSnapshots: 'Point-in-time snapshot creation and restoration',
	vpsBackups: 'Automated and manual backup management',
	vpsRebuild: 'Rebuild VPS from a fresh image',
	vpsResize: 'Change VPS plan and resource allocation',
	vpsRescue: 'Boot into rescue mode for recovery',
	vpsSettings: 'VPS configuration and metadata editing'
};

export type FeatureFlagCategory = 'platform' | 'server';

export const featureFlagCategories: Record<FeatureFlagCategory, FeatureFlagKey[]> = {
	platform: ['colocation', 'firewall', 'images', 'volumes'],
	server: [
		'vpsConsole',
		'vpsLogs',
		'vpsNetworking',
		'vpsImages',
		'vpsSnapshots',
		'vpsBackups',
		'vpsRebuild',
		'vpsResize',
		'vpsRescue',
		'vpsSettings'
	]
};

export const featureFlagCategoryLabels: Record<FeatureFlagCategory, string> = {
	platform: 'Platform Features',
	server: 'VPS Server Tabs'
};

export const vpsServerTabFeatureFlags = {
	console: 'vpsConsole',
	logs: 'vpsLogs',
	networking: 'vpsNetworking',
	images: 'vpsImages',
	snapshots: 'vpsSnapshots',
	backups: 'vpsBackups',
	rebuild: 'vpsRebuild',
	resize: 'vpsResize',
	rescue: 'vpsRescue',
	settings: 'vpsSettings'
} as const satisfies Record<string, FeatureFlagKey>;
