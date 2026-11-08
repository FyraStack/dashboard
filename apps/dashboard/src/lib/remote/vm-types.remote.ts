import { type } from 'arktype';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureVmTypes
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listVmTypes = query(async () => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureVmTypes;
	}
	return await backend((me) => me.listVmTypes());
});

const createParams = type({
	name: 'string',
	isa: "'x86'",
	cores: 'number',
	ramCapacity: 'number',
	storageAmount: 'number',
	rate: 'string',
	cap: 'string',
	autumnFeatureId: 'string'
});
export const createVmType = command(createParams, (input) =>
	backend((me) => me.admin().vmTypes().create(input))
);

const updateParams = type({
	vmTypeId: 'string',
	name: 'string?',
	isa: "'x86'?",
	cores: 'number?',
	ramCapacity: 'number?',
	storageAmount: 'number?',
	rate: 'string?',
	cap: 'string?',
	autumnFeatureId: 'string?'
});
export const updateVmType = command(updateParams, (input) =>
	backend((me) => me.admin().vmTypes().update(input))
);

const reorderParams = type({ vmTypeIds: 'string[]' });
export const reorderVmTypes = command(reorderParams, (input) =>
	backend((me) => me.admin().vmTypes().reorder(input))
);

const deleteParams = type({ vmTypeId: 'string' });
export const deleteVmType = command(deleteParams, (input) =>
	backend((me) => me.admin().vmTypes().delete(input))
);
