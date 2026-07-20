import Activity from '~icons/nucleo/activity';
import Box from '~icons/nucleo/box';
import FileText from '~icons/nucleo/file-text';
import Send from '~icons/nucleo/send';
import type { IconComponent } from '$lib';

export type HostTab = 'overview' | 'podman' | 'quadlets' | 'dispatch';

export const hostTabs: {
	id: HostTab;
	label: string;
	icon: IconComponent;
}[] = [
	{ id: 'overview', label: 'Overview', icon: Activity },
	{ id: 'podman', label: 'Podman', icon: Box },
	{ id: 'quadlets', label: 'Quadlets', icon: FileText },
	{ id: 'dispatch', label: 'Dispatch', icon: Send }
];
