import ArrowUpDown from '~icons/lucide/arrow-up-down';
import Clock from '~icons/nucleo/clock';
import FileText from '~icons/nucleo/file-text';
import Activity from '~icons/nucleo/activity';
import Camera from '~icons/nucleo/camera';
import Disc from '~icons/nucleo/disc';
import Globe from '~icons/nucleo/globe';
import RotateCw from '~icons/nucleo/rotate-cw';
import Settings from '~icons/nucleo/settings';
import Terminal from '~icons/nucleo/terminal';
import type { FeatureFlagKey } from '$lib/feature-flags';
import type { IconComponent } from '$lib';

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
	icon: IconComponent;
	featureFlag?: FeatureFlagKey;
}[] = [
	{ id: 'overview', label: 'Overview', icon: Activity },
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
