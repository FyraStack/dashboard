import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export type { AdminVm } from 'stack-backend/types';

export const listAllAdminVms = query(() => backend((me) => me.admin().vms().list()));

const powerParams = type({ vmId: 'string' });

export const adminStartVm = command(powerParams, (input) =>
	backend((me) => me.admin().vms().start(input))
);
export const adminStopVm = command(powerParams, (input) =>
	backend((me) => me.admin().vms().stop(input))
);
export const adminKillVm = command(powerParams, (input) =>
	backend((me) => me.admin().vms().kill(input))
);
export const adminRebootVm = command(powerParams, (input) =>
	backend((me) => me.admin().vms().reboot(input))
);
export const adminDeleteVm = command(powerParams, (input) =>
	backend((me) => me.admin().vms().delete(input))
);
