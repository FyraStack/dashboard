import type { ServerStatus } from 'stack-shared/vm-status';

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'muted';

export const statusBadgeClass: Record<StatusTone, string> = {
	success:
		'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400',
	info: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400',
	warning:
		'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
	danger:
		'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400',
	accent:
		'border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-400',
	muted: 'border-border bg-background/40 text-muted-foreground'
};

export const statusDotClass: Record<StatusTone, string> = {
	success: 'bg-emerald-500',
	info: 'bg-blue-500',
	warning: 'bg-amber-500',
	danger: 'bg-red-500',
	accent: 'bg-violet-500',
	muted: 'bg-muted-foreground'
};

export interface StatusView {
	badgeLabel: string;
	label: string;
	pending: boolean;
	tone: StatusTone;
}

const statusViews: Record<ServerStatus, StatusView> = {
	running: { badgeLabel: 'running', label: 'Running', tone: 'success', pending: false },
	stopped: { badgeLabel: 'stopped', label: 'Stopped', tone: 'danger', pending: false },
	restarting: { badgeLabel: 'restarting', label: 'Restarting', tone: 'warning', pending: true },
	provisioning: {
		badgeLabel: 'provisioning...',
		label: 'Provisioning',
		tone: 'info',
		pending: true
	},
	deleting: { badgeLabel: 'deleting...', label: 'Deleting', tone: 'danger', pending: true },
	error: { badgeLabel: 'error', label: 'Error', tone: 'danger', pending: false },
	unknown: { badgeLabel: 'unknown', label: 'Unknown', tone: 'muted', pending: false }
};

export const serverStatuses = Object.keys(statusViews) as ServerStatus[];

export function describeServerStatus(status: ServerStatus, liveLoaded = true): StatusView {
	if (status === 'deleting' || liveLoaded) {
		return statusViews[status];
	}
	return statusViews.unknown;
}

export function isPendingStatus(status: ServerStatus): boolean {
	return statusViews[status].pending;
}

export function isLocked(status: ServerStatus): boolean {
	return status === 'provisioning' || status === 'deleting';
}

export function isListedStatus(status: ServerStatus): boolean {
	return status !== 'deleting' && status !== 'error';
}

export function canPowerOn(status: ServerStatus): boolean {
	return !(isLocked(status) || status === 'running' || status === 'restarting');
}

export function canPowerOff(status: ServerStatus): boolean {
	return !(isLocked(status) || status === 'stopped');
}

export function canReboot(status: ServerStatus): boolean {
	return canPowerOff(status) && status !== 'restarting';
}
