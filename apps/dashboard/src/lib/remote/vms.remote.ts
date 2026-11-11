import { type } from 'arktype';
import { createVmFields, metricsTimeframe } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listVms = query(type({ projectId: 'string' }), ({ projectId }) =>
	backend((me) => me.project(projectId).listVms())
);

export const getVm = query(type({ vmId: 'string' }), ({ vmId }) =>
	backend((me) => me.vm(vmId).get())
);

const metricsHistoryParams = type({
	vmId: 'string',
	'timeframe?': metricsTimeframe
});
export const getVmMetricsHistory = query(metricsHistoryParams, ({ vmId, timeframe }) =>
	backend((me) => me.vm(vmId).metricsHistory({ timeframe }))
);

export const listVmStatuses = query(type({ projectId: 'string' }), ({ projectId }) =>
	backend((me) => me.project(projectId).listVmStatuses())
);

const createParams = type({ projectId: 'string', ...createVmFields });
export const createVm = command(createParams, ({ projectId, ...input }) =>
	backend((me) => me.project(projectId).createVm(input))
);

const renameParams = type({ vmId: 'string', name: 'string', updateHostname: 'boolean' });
export const renameVm = command(renameParams, ({ vmId, ...input }) =>
	backend((me) => me.vm(vmId).rename(input))
);

export const deleteVm = command(type({ vmId: 'string' }), ({ vmId }) =>
	backend((me) => me.vm(vmId).delete())
);

const powerParams = type({ vmId: 'string' });
export const startVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).start()));
export const stopVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).stop()));
export const killVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).kill()));
export const rebootVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).reboot()));

export const resizeVm = command(
	type({ vmId: 'string', vmTypeId: 'string' }),
	({ vmId, vmTypeId }) => backend((me) => me.vm(vmId).resize({ vmTypeId }))
);
