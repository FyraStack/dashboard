import {
	ArrowUpDown,
	BarChart3,
	Camera,
	Clock,
	Disc,
	FileText,
	Globe,
	RotateCw,
	Settings,
	Terminal
} from '@lucide/svelte';
import type { FeatureFlagKey } from '$lib/feature-flags';

export type ServerTab =
	| 'overview'
	| 'console'
	| 'logs'
	| 'networking'
	| 'images'
	| 'snapshots'
	| 'backups'
	| 'rebuild'
	| 'resize'
	| 'rescue'
	| 'settings';

export const serverTabs: {
	id: ServerTab;
	label: string;
	icon: typeof BarChart3;
	featureFlag?: FeatureFlagKey;
}[] = [
	{ id: 'overview', label: 'Overview', icon: BarChart3 },
	{ id: 'console', label: 'Console', icon: Terminal, featureFlag: 'vpsConsole' },
	{ id: 'logs', label: 'Logs', icon: FileText, featureFlag: 'vpsLogs' },
	{ id: 'networking', label: 'Networking', icon: Globe, featureFlag: 'vpsNetworking' },
	{ id: 'images', label: 'Images', icon: Disc, featureFlag: 'vpsImages' },
	{ id: 'snapshots', label: 'Snapshots', icon: Camera, featureFlag: 'vpsSnapshots' },
	{ id: 'backups', label: 'Backups', icon: Clock, featureFlag: 'vpsBackups' },
	{ id: 'rebuild', label: 'Rebuild', icon: RotateCw, featureFlag: 'vpsRebuild' },
	{ id: 'resize', label: 'Resize', icon: ArrowUpDown, featureFlag: 'vpsResize' },
	{ id: 'rescue', label: 'Rescue', icon: Terminal, featureFlag: 'vpsRescue' },
	{ id: 'settings', label: 'Settings', icon: Settings, featureFlag: 'vpsSettings' }
];
