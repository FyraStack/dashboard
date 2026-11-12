import { type } from 'arktype';
import { createVmFields, idempotencyKeySchema, verificationMethod } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export type { AdminProject, AdminProjectBillingStatus } from 'stack-backend/types';

export const listAdminProjects = query(() => backend((me) => me.admin().projects().list()));

const setBillingExemptParams = type({ projectId: 'string', billingExempt: 'boolean' });
export const setProjectBillingExempt = command(setBillingExemptParams, (input) =>
	backend((me) => me.admin().projects().setBillingExempt(input))
);

const createProjectParams = type({
	name: 'string',
	ownerUserId: 'string',
	idempotencyKey: idempotencyKeySchema
});
export const createAdminProject = command(createProjectParams, (input) =>
	backend((me) => me.admin().projects().create(input))
);

const createVmParams = type({ projectId: 'string', ...createVmFields });
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

const deleteProjectParams = type({
	projectId: 'string',
	method: verificationMethod,
	code: 'string?'
});
export const deleteProjectWithVerification = command(deleteProjectParams, (input) =>
	backend((me) => me.admin().projects().deleteWithVerification(input))
);
