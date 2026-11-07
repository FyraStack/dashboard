import { type } from 'arktype';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureProjectDetails,
	accessibilityFixtureProjects
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listProjects = query(async () => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureProjects;
	}

	return await backend((me) => me.projects().list());
});

const getParams = type({ projectId: 'string' });
export const getProject = query(getParams, async ({ projectId }) => {
	if (accessibilityFixtureEnabled && projectId === accessibilityFixtureProjectDetails.id) {
		return accessibilityFixtureProjectDetails;
	}

	return await backend((me) => me.project(projectId).get());
});

const createParams = type({ name: 'string', idempotencyKey: '0 < string <= 128' });
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
	permissions: "'admin' | 'read_write' | 'read'"
});
export const addMember = command(addMemberParams, ({ email, permissions, projectId }) =>
	backend((me) => me.project(projectId).addMember({ email, permissions }))
);

const updateMemberRoleParams = type({
	projectId: 'string',
	userId: 'string',
	permissions: "'admin' | 'read_write' | 'read'"
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
