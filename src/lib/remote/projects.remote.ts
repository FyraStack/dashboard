import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq, and, or, sql } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { projects, projectPermissions } from '$lib/server/db/schema';
import { user } from '$lib/server/db/auth.schema';
import { requireProjectAccess } from '$lib/server/auth-context';

type ListResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	role: 'owner' | 'admin' | 'read_write' | 'read';
}[];

export const listProjects = query(async () => {
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
type MemberInfo = { userId: string; name: string; email: string; permissions: string };
type GetResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	ownerName: string;
	ownerEmail: string;
	creationDate: number;
	members: MemberInfo[];
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

	const ownerUser = await db.query.user.findFirst({
		where: eq(user.id, project.ownerUserId)
	});

	const memberUserIds = project.permissions.map((p: { userId: string }) => p.userId);
	const memberUsers =
		memberUserIds.length > 0
			? await db.query.user.findMany({
					where: or(...memberUserIds.map((id: string) => eq(user.id, id)))
				})
			: [];

	const memberUserMap = new Map(memberUsers.map((u) => [u.id, u]));

	return {
		id: project.id,
		projectName: project.projectName,
		ownerUserId: project.ownerUserId,
		ownerName: ownerUser?.name ?? 'Unknown',
		ownerEmail: ownerUser?.email ?? '',
		creationDate: project.creationDate,
		members: project.permissions.map((p: { userId: string; permissions: string }) => {
			const memberUser = memberUserMap.get(p.userId);
			return {
				userId: p.userId,
				name: memberUser?.name ?? 'Unknown',
				email: memberUser?.email ?? '',
				permissions: p.permissions
			};
		})
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

	await db.delete(projectPermissions).where(eq(projectPermissions.projectId, params.projectId));
	await db.delete(projects).where(eq(projects.id, params.projectId));
});

const updateParams = type({ projectId: 'string', name: 'string' });
export const updateProject = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	const project = await db.query.projects.findFirst({
		where: eq(projects.id, params.projectId)
	});

	if (!project) error(404, 'Project not found');

	await db
		.update(projects)
		.set({ projectName: params.name })
		.where(eq(projects.id, params.projectId));
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
			and(
				eq(projectPermissions.projectId, params.projectId),
				eq(projectPermissions.userId, params.userId)
			)
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
			and(
				eq(projectPermissions.projectId, params.projectId),
				eq(projectPermissions.userId, params.userId)
			)
		);
});

type SearchUsersResult = { id: string; name: string; email: string }[];

const searchUsersParams = type({ query: 'string', limit: 'number?' });
export const searchUsers = query(searchUsersParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const limit = params.limit ?? 10;

	const results = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email
		})
		.from(user)
		.where(
			sql`${user.email} ILIKE ${'%' + params.query + '%'} OR ${user.name} ILIKE ${'%' + params.query + '%'}`
		)
		.limit(limit);

	return results.filter((r) => r.id !== event.locals.user!.id) as SearchUsersResult;
});
