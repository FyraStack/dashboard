import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { projects, projectPermissions } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/rpc/context';

type ListResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	role: 'owner' | 'admin' | 'read_write' | 'read';
}[];

export const listProjects = query(type({}), async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	const owned = await db.query.projects.findMany({
		where: eq(projects.ownerUserId, event.locals.user.id)
	});

	const shared = await db.query.projectPermissions.findMany({
		where: eq(projectPermissions.userId, event.locals.user.id),
		with: { project: true }
	});

	const results: ListResult = owned.map((p) => ({
		...p,
		role: 'owner' as const
	}));

	for (const perm of shared) {
		if (perm.project && !results.some((r) => r.id === perm.project.id)) {
			results.push({
				...perm.project,
				role: perm.permissions
			});
		}
	}

	return results;
});

const getParams = type({ projectId: 'string' });
type GetResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	members: { userId: string; permissions: string }[];
};

export const getProject = query(getParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const project = await db.query.projects.findFirst({
		where: eq(projects.id, params.projectId),
		with: { permissions: true }
	});

	if (!project) error(404, 'Project not found');

	return {
		id: project.id,
		projectName: project.projectName,
		ownerUserId: project.ownerUserId,
		creationDate: project.creationDate,
		members: project.permissions.map((p) => ({
			userId: p.userId,
			permissions: p.permissions
		}))
	};
});

const createParams = type({ name: 'string' });
export const createProject = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	const [inserted] = await db
		.insert(projects)
		.values({
			projectName: params.name,
			ownerUserId: event.locals.user.id,
			creationDate: Date.now()
		})
		.returning();

	return { id: inserted.id };
});

const deleteParams = type({ projectId: 'string' });
export const deleteProject = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, params.projectId)
	});

	if (!project) error(404, 'Project not found');
	if (project.ownerUserId !== event.locals.user.id) {
		error(403, 'Only the project owner can delete it');
	}

	await db
		.delete(projectPermissions)
		.where(eq(projectPermissions.projectId, params.projectId));
	await db.delete(projects).where(eq(projects.id, params.projectId));
});

const addMemberParams = type({
	projectId: 'string',
	userId: 'string',
	permissions: "'admin' | 'read_write' | 'read'"
});
export const addMember = command(addMemberParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	await db
		.delete(projectPermissions)
		.where(
			eq(projectPermissions.projectId, params.projectId)
		);

	await db.insert(projectPermissions).values({
		projectId: params.projectId,
		userId: params.userId,
		permissions: params.permissions
	});
});

const removeMemberParams = type({ projectId: 'string', userId: 'string' });
export const removeMember = command(removeMemberParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	await db
		.delete(projectPermissions)
		.where(
			eq(projectPermissions.projectId, params.projectId)
		);
});
