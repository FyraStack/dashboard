import Activity from '~icons/nucleo/activity';
import Box from '~icons/nucleo/box';
import Send from '~icons/nucleo/send';
import type { IconComponent } from '$lib';

export type HostTab = 'overview' | 'podman' | 'dispatch';

export const hostTabs: {
	id: HostTab;
	label: string;
	icon: IconComponent;
}[] = [
	{ id: 'overview', label: 'Overview', icon: Activity },
	{ id: 'podman', label: 'Podman', icon: Box },
	{ id: 'dispatch', label: 'Dispatch', icon: Send }
];
