import { type } from 'arktype';
import type { AdminProject } from 'stack-backend/types';
import {
	accessibilityFixtureAdminProjects,
	accessibilityFixtureEnabled
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export type { AdminProject, AdminProjectBillingStatus } from 'stack-backend/types';

export const listAdminProjects = query(async (): Promise<AdminProject[]> => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureAdminProjects;
	}
	return await backend((me) => me.admin().projects().list());
});

const setBillingExemptParams = type({ projectId: 'string', billingExempt: 'boolean' });
export const setProjectBillingExempt = command(setBillingExemptParams, (input) =>
	backend((me) => me.admin().projects().setBillingExempt(input))
);

const createProjectParams = type({
	name: 'string',
	ownerUserId: 'string',
	idempotencyKey: '0 < string <= 128'
});
export const createAdminProject = command(createProjectParams, (input) =>
	backend((me) => me.admin().projects().create(input))
);

const createVmParams = type({
	projectId: 'string',
	vmTypeId: 'string',
	name: 'string',
	networkingMode: "'both' | 'ipv6'?",
	imageId: 'string?',
	sshKeyIds: 'string[]?',
	password: 'string?',
	idempotencyKey: '0 < string <= 128'
});
export const createAdminVm = command(createVmParams, (input) =>
	backend((me) => me.admin().projects().createVm(input))
);

const setDisabledParams = type({ projectId: 'string', disabled: 'boolean' });
export const setProjectDisabled = command(setDisabledParams, (input) =>
	backend((me) => me.admin().projects().setDisabled(input))
);

const beginDeleteProjectParams = type({ projectId: 'string' });
export const beginDeleteProject = command(beginDeleteProjectParams, (input) =>
	backend((me) => me.admin().projects().beginDelete(input))
);

const deleteProjectParams = type({ projectId: 'string', method: 'string', code: 'string?' });
export const deleteProjectWithVerification = command(deleteProjectParams, (input) =>
	backend((me) => me.admin().projects().deleteWithVerification(input))
);
