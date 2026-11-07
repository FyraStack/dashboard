import { and, eq } from 'drizzle-orm';
import { type ProjectRole, projectRoles } from '#lib/auth/organization-permissions.js';
import { initAuth } from '#lib/server/auth.js';
import { requireProjectAccess } from '#lib/server/auth-context.js';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer,
	updateProjectCustomer
} from '#lib/server/billing/autumn.js';
import { context } from '#lib/server/context.js';
import { member, organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { softDeleteOrganizationResources } from '#lib/server/project-deletion.js';

export type ProjectListResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	role: ProjectRole;
}[];

export interface ProjectMemberInfo {
	email: string;
	name: string;
	permissions: ProjectRole;
	userId: string;
}

export interface ProjectDetails {
	creationDate: number;
	id: string;
	members: ProjectMemberInfo[];
	ownerEmail: string;
	ownerName: string;
	ownerUserId: string;
	projectName: string;
}

export interface GetProjectInput {
	projectId: string;
}
export interface CreateProjectInput {
	idempotencyKey: string;
	name: string;
}
export interface DeleteProjectInput {
	projectId: string;
}
export interface UpdateProjectInput {
	name: string;
	projectId: string;
}
export interface AddMemberInput {
	email: string;
	permissions: 'admin' | 'read_write' | 'read';
	projectId: string;
}
export interface UpdateMemberRoleInput {
	permissions: 'admin' | 'read_write' | 'read';
	projectId: string;
	userId: string;
}
export interface RemoveMemberInput {
	projectId: string;
	userId: string;
}

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

export async function listProjects(): Promise<ProjectListResult> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const userId = locals.user.id;
	const db = initDrizzle();
	const memberships = await db.query.member.findMany({
		where: eq(member.userId, userId),
		with: { organization: { with: { members: true } } }
	});

	return memberships.flatMap((membership) => {
		const org = membership.organization;
		if (!org || org.deletedAt !== null) {
			return [];
		}
		const owner = org.members.find((item: { role: string }) => item.role === 'owner');
		return [
			{
				id: org.id,
				projectName: org.name,
				ownerUserId: owner?.userId ?? userId,
				creationDate: org.createdAt.getTime(),
				role: toProjectRole(membership.role)
			}
		];
	}) satisfies ProjectListResult;
}

export async function getProject(input: GetProjectInput): Promise<ProjectDetails> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId);

	const org = await db.query.organization.findFirst({
		where: eq(organization.id, input.projectId),
		with: { members: { with: { user: true } } }
	});

	if (!org) {
		error(404, 'Project not found');
	}

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
}

export function createProject(input: CreateProjectInput): Promise<{ id: string }> {
	const { locals, request } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const userId = locals.user.id;
	const name = toProjectName(input.name);
	return withIdempotency(
		initDrizzle(),
		{ key: input.idempotencyKey, operation: 'projects.createProject', args: { name, userId } },
		async () => {
			const auth = initAuth();
			const org = await auth.api.createOrganization({
				headers: request.headers,
				body: {
					name,
					slug: toSlug(name)
				}
			});

			await ensureLocalProjectBillingCustomer(org.id);
			ensureProjectCustomer(org.id).catch((err) => {
				console.warn(`Failed to sync Autumn customer for project ${org.id}`, err);
			});
			captureServerEvent('project_created', {}, { projectId: org.id });

			return { id: org.id };
		}
	);
}

export async function deleteProject(input: DeleteProjectInput): Promise<void> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'owner');

	await softDeleteOrganizationResources(db, input.projectId);
	captureServerEvent('project_deleted', {}, { projectId: input.projectId });
}

export async function updateProject(input: UpdateProjectInput): Promise<void> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');

	await db
		.update(organization)
		.set({ name: toProjectName(input.name) })
		.where(eq(organization.id, input.projectId));

	updateProjectCustomer(input.projectId).catch((err) => {
		console.warn(`Failed to sync Autumn customer update for project ${input.projectId}`, err);
	});
	captureServerEvent('project_renamed', {}, { projectId: input.projectId });
}

export async function addMember(input: AddMemberInput): Promise<void> {
	const { locals, request } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');

	const auth = initAuth();
	await auth.api.createInvitation({
		headers: request.headers,
		body: {
			email: input.email.trim(),
			role: input.permissions,
			organizationId: input.projectId,
			resend: true
		}
	});
	captureServerEvent(
		'project_member_invited',
		{ permissions: input.permissions },
		{ projectId: input.projectId }
	);
}

export async function updateMemberRole(input: UpdateMemberRoleInput): Promise<void> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');

	await db
		.update(member)
		.set({ role: input.permissions })
		.where(and(eq(member.organizationId, input.projectId), eq(member.userId, input.userId)));
	captureServerEvent(
		'project_member_role_updated',
		{ member_user_id: input.userId, permissions: input.permissions },
		{ projectId: input.projectId }
	);
}

export async function removeMember(input: RemoveMemberInput): Promise<void> {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireProjectAccess(db, locals.user.id, input.projectId, 'admin');

	const target = await db.query.member.findFirst({
		where: and(eq(member.organizationId, input.projectId), eq(member.userId, input.userId))
	});
	if (!target) {
		return;
	}
	if (target.role === 'owner') {
		error(400, 'Project owner cannot be removed');
	}

	await db.delete(member).where(eq(member.id, target.id));
	captureServerEvent(
		'project_member_removed',
		{ member_user_id: input.userId, previous_role: target.role },
		{ projectId: input.projectId }
	);
}
