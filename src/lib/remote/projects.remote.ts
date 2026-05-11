import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, inArray } from 'drizzle-orm';
import { projectRoles, type ProjectRole } from '$lib/auth/organization-permissions';
import { initDrizzle } from '$lib/server/db';
import {
	invitation,
	ipAssignments,
	member,
	organization,
	paymentPeriods,
	vms,
	volumes
} from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/auth-context';
import { initAuth } from '$lib/server/auth';
import { getBackend } from '$lib/server/backends';
import {
	attachDefaultProjectPlan,
	deleteLocalProjectBillingCustomer,
	deleteProjectServerEntity,
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer,
	updateProjectCustomer
} from '$lib/server/billing/autumn';
import { meterResourceThrough, syncProjectUsage } from '$lib/server/billing/metering';

type ListResult = {
	id: string;
	projectName: string;
	ownerUserId: string;
	creationDate: number;
	role: ProjectRole;
}[];

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

export const listProjects = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const memberships = await db.query.member.findMany({
		where: eq(member.userId, event.locals.user.id),
		with: { organization: { with: { members: true } } }
	});

	return memberships
		.filter((membership) => membership.organization)
		.map((membership) => {
			const org = membership.organization!;
			const owner = org.members.find((item: { role: string }) => item.role === 'owner');
			return {
				id: org.id,
				projectName: org.name,
				ownerUserId: owner?.userId ?? membership.userId,
				creationDate: org.createdAt.getTime(),
				role: toProjectRole(membership.role)
			};
		}) satisfies ListResult;
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
	const billingSetupUrl = await attachDefaultProjectPlan(
		org.id,
		`${event.url.origin}/projects/${org.id}/billing`
	).catch((err) => {
		console.warn(`Failed to attach default Autumn plan for project ${org.id}`, err);
		return null;
	});

	return { id: org.id, billingSetupUrl };
});

const deleteParams = type({ projectId: 'string' });
export const deleteProject = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'owner');

	const projectVms = await db.query.vms.findMany({
		where: eq(vms.ownerProjectId, params.projectId),
		columns: { id: true, name: true, proxmoxId: true, active: true, backend: true }
	});
	const vmIds = projectVms.map((vm) => vm.id);
	const projectVolumes = await db.query.volumes.findMany({
		where: eq(volumes.ownerProjectId, params.projectId),
		columns: { id: true }
	});

	for (const vm of projectVms.filter((item) => item.active)) {
		try {
			await getBackend(vm.backend).deleteVm(vm.id, vm.proxmoxId ?? undefined);
		} catch (err) {
			console.warn(`Failed to deprovision VM ${vm.id} during project delete`, err);
			error(502, `Failed to deprovision VM "${vm.name}" in Proxmox`);
		}
	}

	for (const vm of projectVms.filter((item) => item.active)) {
		const metered = await meterResourceThrough('vm', vm.id);
		if (!metered?.event || metered.syncStatus === 'synced') {
			await deleteProjectServerEntity(params.projectId, vm.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${vm.id}`, err);
			});
		}
	}
	await syncProjectUsage(params.projectId);

	await db.delete(volumes).where(eq(volumes.ownerProjectId, params.projectId));
	if (vmIds.length > 0) {
		await db.delete(ipAssignments).where(inArray(ipAssignments.associatedVmId, vmIds));
		await db.delete(paymentPeriods).where(inArray(paymentPeriods.vmId, vmIds));
	}
	await db.delete(vms).where(eq(vms.ownerProjectId, params.projectId));
	await db.delete(invitation).where(eq(invitation.organizationId, params.projectId));
	await db.delete(member).where(eq(member.organizationId, params.projectId));
	await deleteLocalProjectBillingCustomer(params.projectId);
	await db.delete(organization).where(eq(organization.id, params.projectId));
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
});
