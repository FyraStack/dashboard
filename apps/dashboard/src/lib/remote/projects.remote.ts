import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq } from 'drizzle-orm';
import { projectRoles, type ProjectRole } from '$lib/auth/organization-permissions';
import { initDrizzle } from '$lib/server/db';
import { member, organization } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/auth-context';
import { initAuth } from '$lib/server/auth';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer,
	updateProjectCustomer
} from '$lib/server/billing/autumn';
import { softDeleteOrganizationResources } from '$lib/server/project-deletion';

type ListResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	role: ProjectRole;
}[];

type ProjectListCacheEntry = {
	projects?: ListResult;
	expiresAt: number;
	promise?: Promise<ListResult>;
};

type MemberInfo = { userId: string; name: string; email: string; permissions: ProjectRole };
type GetResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	ownerName: string;
	ownerEmail: string;
	creationDate: number;
	members: MemberInfo[];
};

const PROJECT_LIST_CACHE_TTL_MS = 5_000;
const projectListCache = new Map<string, ProjectListCacheEntry>();

function toProjectName(name: string) {
	return name.trim() || 'Untitled Project';
}

function toSlug(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 42);

	return `${slug || 'project'}-${Date.now().toString(36)}`;
}

function toProjectRole(role: string): ProjectRole {
	return projectRoles.includes(role as ProjectRole) ? (role as ProjectRole) : 'read';
}

function cloneProjects(projects: ListResult): ListResult {
	return projects.map((project) => ({ ...project }));
}

function clearProjectListCache(userId?: string) {
	if (userId) {
		projectListCache.delete(userId);
		return;
	}

	projectListCache.clear();
}

async function loadProjectsForUser(userId: string): Promise<ListResult> {
	const db = initDrizzle();
	const memberships = await db.query.member.findMany({
		where: eq(member.userId, userId),
		with: { organization: { with: { members: true } } }
	});

	return memberships
		.filter((membership) => membership.organization && membership.organization.deletedAt == null)
		.map((membership) => {
			const org = membership.organization!;
			const owner = org.members.find((item: { role: string }) => item.role === 'owner');
			return {
				id: org.id,
				projectName: org.name,
				ownerUserId: owner?.userId ?? userId,
				creationDate: org.createdAt.getTime(),
				role: toProjectRole(membership.role)
			};
		}) satisfies ListResult;
}

async function getCachedProjectsForUser(userId: string): Promise<ListResult> {
	const now = Date.now();
	const cached = projectListCache.get(userId);

	if (cached?.projects && now < cached.expiresAt) {
		return cloneProjects(cached.projects);
	}

	if (cached?.promise) {
		return cloneProjects(await cached.promise);
	}

	const promise = loadProjectsForUser(userId)
		.then((projects) => {
			projectListCache.set(userId, {
				projects: cloneProjects(projects),
				expiresAt: Date.now() + PROJECT_LIST_CACHE_TTL_MS
			});
			return projects;
		})
		.catch((err) => {
			projectListCache.delete(userId);
			throw err;
		});

	projectListCache.set(userId, {
		...(cached?.projects ? { projects: cached.projects } : {}),
		expiresAt: cached?.expiresAt ?? 0,
		promise
	});

	return cloneProjects(await promise);
}

export const listProjects = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	return getCachedProjectsForUser(event.locals.user.id);
});

const getParams = type({ projectId: 'string' });
export const getProject = query(getParams, async (params): Promise<GetResult> => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId),
		with: { members: { with: { user: true } } }
	});

	if (!org) error(404, 'Project not found');

	const owner =
		org.members.find((item: { role: string }) => item.role === 'owner') ?? org.members[0];
	const ownerUser = owner?.user;

	return {
		id: org.id,
		projectName: org.name,
		ownerUserId: owner?.userId ?? '',
		ownerName: ownerUser?.name ?? 'Unknown',
		ownerEmail: ownerUser?.email ?? '',
		creationDate: org.createdAt.getTime(),
		members: org.members
			.filter((item: { role: string }) => item.role !== 'owner')
			.map((item) => ({
				userId: item.userId,
				name: item.user?.name ?? 'Unknown',
				email: item.user?.email ?? '',
				permissions: toProjectRole(item.role)
			}))
	};
});

const createParams = type({ name: 'string' });
export const createProject = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const name = toProjectName(params.name);
	const auth = initAuth();
	const org = await auth.api.createOrganization({
		headers: event.request.headers,
		body: {
			name,
			slug: toSlug(name)
		}
	});

	await ensureLocalProjectBillingCustomer(org.id);
	ensureProjectCustomer(org.id).catch((err) => {
		console.warn(`Failed to sync Autumn customer for project ${org.id}`, err);
	});
	clearProjectListCache(event.locals.user.id);

	return { id: org.id };
});

const deleteParams = type({ projectId: 'string' });
export const deleteProject = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'owner');

	await softDeleteOrganizationResources(db, params.projectId);
	clearProjectListCache();
});

const updateParams = type({ projectId: 'string', name: 'string' });
export const updateProject = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	await db
		.update(organization)
		.set({ name: toProjectName(params.name) })
		.where(eq(organization.id, params.projectId));

	updateProjectCustomer(params.projectId).catch((err) => {
		console.warn(`Failed to sync Autumn customer update for project ${params.projectId}`, err);
	});
	clearProjectListCache();
});

const addMemberParams = type({
	projectId: 'string',
	email: 'string',
	permissions: "'admin' | 'read_write' | 'read'"
});
export const addMember = command(addMemberParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	const auth = initAuth();
	await auth.api.createInvitation({
		headers: event.request.headers,
		body: {
			email: params.email.trim(),
			role: params.permissions,
			organizationId: params.projectId,
			resend: true
		}
	});
});

const updateMemberRoleParams = type({
	projectId: 'string',
	userId: 'string',
	permissions: "'admin' | 'read_write' | 'read'"
});
export const updateMemberRole = command(updateMemberRoleParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	await db
		.update(member)
		.set({ role: params.permissions })
		.where(and(eq(member.organizationId, params.projectId), eq(member.userId, params.userId)));
	clearProjectListCache();
});

const removeMemberParams = type({ projectId: 'string', userId: 'string' });
export const removeMember = command(removeMemberParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'admin');

	const target = await db.query.member.findFirst({
		where: and(eq(member.organizationId, params.projectId), eq(member.userId, params.userId))
	});
	if (!target) return;
	if (target.role === 'owner') error(400, 'Project owner cannot be removed');

	await db.delete(member).where(eq(member.id, target.id));
	clearProjectListCache();
});
