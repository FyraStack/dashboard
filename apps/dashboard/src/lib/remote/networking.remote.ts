import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

const vmParams = type({ vmId: 'string' });

export const getVmNetworking = query(vmParams, ({ vmId }) =>
	backend((me) => me.vm(vmId).networking())
);

const setPtrParams = type({
	vmId: 'string',
	allocationId: 'string',
	address: 'string?',
	value: 'string'
});

export const setVmPtrRecord = command(setPtrParams, ({ address, allocationId, value, vmId }) =>
	backend((me) => me.vm(vmId).setPtrRecord({ address, allocationId, value }))
);
