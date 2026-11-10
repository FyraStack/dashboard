export type VmLifecycleStatus = 'provisioning' | 'ready' | 'error' | 'deleting';

export type VmPowerState = 'running' | 'stopped' | 'paused' | 'unknown';

export type ServerStatus =
	| 'running'
	| 'stopped'
	| 'restarting'
	| 'provisioning'
	| 'deleting'
	| 'error'
	| 'unknown';

export function toServerStatus(
	status: VmLifecycleStatus | null | undefined,
	powerState: VmPowerState | null | undefined
): ServerStatus {
	if (status && status !== 'ready') {
		return status;
	}
	switch (powerState) {
		case 'running':
			return 'running';
		case 'paused':
			return 'restarting';
		case 'stopped':
			return 'stopped';
		default:
			return 'unknown';
	}
}

export const lifecycleStatuses = [
	'provisioning',
	'deleting',
	'error'
] as const satisfies readonly ServerStatus[];

export function isLifecycleStatus(status: ServerStatus): boolean {
	return (lifecycleStatuses as readonly ServerStatus[]).includes(status);
}
