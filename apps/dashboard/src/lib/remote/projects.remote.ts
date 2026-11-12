import { type } from 'arktype';
import { idempotencyKeySchema, permissionLevel } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listProjects = query(() => backend((me) => me.projects().list()));

const getParams = type({ projectId: 'string' });
export const getProject = query(getParams, ({ projectId }) =>
	backend((me) => me.project(projectId).get())
);

const createParams = type({ name: 'string', idempotencyKey: idempotencyKeySchema });
export const createProject = command(createParams, ({ idempotencyKey, name }) =>
	backend((me) => me.projects().create({ idempotencyKey, name }))
);

const deleteParams = type({ projectId: 'string' });
export const deleteProject = command(deleteParams, ({ projectId }) =>
	backend((me) => me.project(projectId).delete())
);

const updateParams = type({ projectId: 'string', name: 'string' });
export const updateProject = command(updateParams, ({ name, projectId }) =>
	backend((me) => me.project(projectId).update({ name }))
);

const addMemberParams = type({
	projectId: 'string',
	email: 'string',
	permissions: permissionLevel
});
export const addMember = command(addMemberParams, ({ email, permissions, projectId }) =>
	backend((me) => me.project(projectId).addMember({ email, permissions }))
);

const updateMemberRoleParams = type({
	projectId: 'string',
	userId: 'string',
	permissions: permissionLevel
});
export const updateMemberRole = command(
	updateMemberRoleParams,
	({ permissions, projectId, userId }) =>
		backend((me) => me.project(projectId).updateMemberRole({ permissions, userId }))
);

const removeMemberParams = type({ projectId: 'string', userId: 'string' });
export const removeMember = command(removeMemberParams, ({ projectId, userId }) =>
	backend((me) => me.project(projectId).removeMember({ userId }))
);
