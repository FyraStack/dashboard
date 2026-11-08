import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export type { VmBillingUsage } from 'stack-backend/types';

const usageParams = type({ vmId: 'string', periodStart: 'number', periodEnd: 'number' });

export const getVmBillingUsage = query(usageParams, (input) =>
	backend((me) => me.admin().billing().vmUsage(input))
);

const reverseParams = type({
	vmId: 'string',
	periodStart: 'number',
	periodEnd: 'number',
	'note?': 'string'
});

export const reverseVmBillingUsage = command(reverseParams, (input) =>
	backend((me) => me.admin().billing().reverseVmUsage(input))
);
