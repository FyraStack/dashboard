import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { VerificationMethod } from 'stack-shared/auth';
import AdminProjectDeletionCodeEmail from '#lib/emails/admin-project-deletion-code.svelte';
import {
	beginAdminVerification,
	consumeAdminVerification
} from '#lib/server/admin-verification.js';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { requireProjectBillingActive } from '#lib/server/billing/state.js';
import { makeCountMap } from '#lib/server/count-map.js';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { projectBillingCustomers, vms, volumes } from '#lib/server/db/schema.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { createOwnedProject, toProjectName } from '#lib/server/project-creation.js';
import { softDeleteOrganizationResources } from '#lib/server/project-deletion.js';
import { VERIFICATION_CODE_TTL_MS } from '#lib/server/verification-codes.js';
import { provisionRequestedVm, type RequestedVm } from '#lib/server/vm-provisioning.js';

export type AdminProjectBillingStatus = 'configured' | 'past_due' | 'suspended' | 'none';

export interface AdminProject {
	billingExempt: boolean;
	billingStatus: AdminProjectBillingStatus;
	createdAt: number;
	disabled: boolean;
	id: string;
	memberCount: number;
	name: string;
	ownerBillingExempt: boolean;
	ownerEmail: string | null;
	ownerId: string | null;
	ownerName: string | null;
	slug: string;
	vmCount: number;
	volumeCount: number;
}

export interface SetProjectBillingExemptInput {
	billingExempt: boolean;
	projectId: string;
}

export interface CreateAdminProjectInput {
	idempotencyKey: string;
	name: string;
	ownerUserId: string;
}

export interface CreateAdminVmInput extends RequestedVm {
	idempotencyKey: string;
}

export interface SetProjectDisabledInput {
	disabled: boolean;
	projectId: string;
}

export interface BeginDeleteProjectInput {
	projectId: string;
}

export interface DeleteProjectWithVerificationInput {
	code?: string;
	method: VerificationMethod;
	projectId: string;
}

export interface GetOrganizationResourcesInput {
	orgId: string;
}

async function requireLiveProject(db: Database, projectId: string) {
	const project = await db.query.organization.findFirst({
		where: and(eq(organization.id, projectId), isNull(organization.deletedAt))
	});
	if (!project) {
		error(404, 'Project not found');
	}
	return project;
}

function toBillingStatus(
	billing: { suspendedAt: number | null; pastDueSince: number | null } | undefined
): AdminProjectBillingStatus {
	if (!billing) {
		return 'none';
	}
	if (billing.suspendedAt !== null) {
		return 'suspended';
	}
	if (billing.pastDueSince !== null) {
		return 'past_due';
	}
	return 'configured';
}

export async function listAdminProjects(): Promise<AdminProject[]> {
	const { db } = await requireAdminUser();

	const [orgs, owners, memberCounts, vmCounts, volumeCounts, billingCustomers] = await Promise.all([
		db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				createdAt: organization.createdAt,
				billingExempt: organization.billingExempt,
				disabled: organization.disabled
			})
			.from(organization)
			.where(isNull(organization.deletedAt))
			.orderBy(desc(organization.createdAt)),
		db
			.select({
				organizationId: member.organizationId,
				userId: user.id,
				name: user.name,
				email: user.email,
				billingExempt: user.billingExempt
			})
			.from(member)
			.innerJoin(user, eq(user.id, member.userId))
			.where(eq(member.role, 'owner')),
		db
			.select({ key: member.organizationId, count: count() })
			.from(member)
			.groupBy(member.organizationId),
		db
			.select({ key: vms.ownerProjectId, count: count() })
			.from(vms)
			.where(eq(vms.active, true))
			.groupBy(vms.ownerProjectId),
		db
			.select({ key: volumes.ownerProjectId, count: count() })
			.from(volumes)
			.groupBy(volumes.ownerProjectId),
		db
			.select({
				projectId: projectBillingCustomers.projectId,
				pastDueSince: projectBillingCustomers.pastDueSince,
				suspendedAt: projectBillingCustomers.suspendedAt
			})
			.from(projectBillingCustomers)
	]);

	const ownerByProject = new Map(owners.map((owner) => [owner.organizationId, owner]));
	const memberMap = makeCountMap(memberCounts);
	const vmMap = makeCountMap(vmCounts);
	const volumeMap = makeCountMap(volumeCounts);
	const billingByProject = new Map(billingCustomers.map((row) => [row.projectId, row]));

	return orgs.map((org) => {
		const owner = ownerByProject.get(org.id);
		const billingStatus = toBillingStatus(billingByProject.get(org.id));

		return {
			id: org.id,
			name: org.name,
			slug: org.slug,
			createdAt: org.createdAt.getTime(),
			ownerId: owner?.userId ?? null,
			ownerName: owner?.name ?? null,
			ownerEmail: owner?.email ?? null,
			ownerBillingExempt: owner?.billingExempt ?? false,
			memberCount: memberMap.get(org.id) ?? 0,
			vmCount: vmMap.get(org.id) ?? 0,
			volumeCount: volumeMap.get(org.id) ?? 0,
			billingStatus,
			billingExempt: org.billingExempt,
			disabled: org.disabled
		};
	});
}

export async function setProjectBillingExempt(params: SetProjectBillingExemptInput) {
	const { db } = await requireAdminUser();
	await requireLiveProject(db, params.projectId);

	await db
		.update(organization)
		.set({ billingExempt: params.billingExempt })
		.where(eq(organization.id, params.projectId));

	return { projectId: params.projectId, billingExempt: params.billingExempt };
}

export async function createAdminProject(params: CreateAdminProjectInput) {
	const { db, user: adminUser } = await requireAdminUser();

	const owner = await db.query.user.findFirst({ where: eq(user.id, params.ownerUserId) });
	if (!owner) {
		error(404, 'User not found');
	}

	const name = toProjectName(params.name);
	return withIdempotency(
		db,
		{
			key: params.idempotencyKey,
			operation: 'admin.createProject',
			args: { name, ownerUserId: params.ownerUserId, userId: adminUser.id }
		},
		() => createOwnedProject(name, params.ownerUserId)
	);
}

export async function createAdminVm(params: CreateAdminVmInput) {
	const { db, user: adminUser } = await requireAdminUser();

	const project = await requireLiveProject(db, params.projectId);
	if (project.disabled) {
		error(400, 'This project is disabled');
	}

	const { billingExempt } = await requireProjectBillingActive(params.projectId);

	const [owner] = await db
		.select({ userId: member.userId })
		.from(member)
		.where(and(eq(member.organizationId, params.projectId), eq(member.role, 'owner')))
		.limit(1);

	const sshKeyIds = params.sshKeyIds ?? [];
	const { idempotencyKey, ...operationArgs } = params;
	return withIdempotency(
		db,
		{
			key: idempotencyKey,
			operation: 'admin.createVm',
			args: { ...operationArgs, userId: adminUser.id, sshKeyIds: [...sshKeyIds].sort() }
		},
		async () =>
			(
				await provisionRequestedVm(db, params, {
					billingExempt,
					keyOwnerId: owner?.userId,
					userId: owner?.userId ?? adminUser.id
				})
			).created
	);
}

export async function setProjectDisabled(params: SetProjectDisabledInput) {
	const { db } = await requireAdminUser();
	await requireLiveProject(db, params.projectId);

	await db
		.update(organization)
		.set({ disabled: params.disabled })
		.where(eq(organization.id, params.projectId));

	captureServerEvent(
		'admin_project_disabled_changed',
		{ disabled: params.disabled },
		{ projectId: params.projectId }
	);

	return { projectId: params.projectId, disabled: params.disabled };
}

export async function beginDeleteProject(params: BeginDeleteProjectInput) {
	const { db, user: adminUser } = await requireAdminUser();
	const target = await requireLiveProject(db, params.projectId);

	const { method, code } = await beginAdminVerification(db, adminUser.id, params.projectId);

	if (code) {
		await sendRenderedEmail({
			component: AdminProjectDeletionCodeEmail,
			props: {
				userName: adminUser.name,
				projectName: target.name,
				code,
				expiresInMinutes: VERIFICATION_CODE_TTL_MS / 60_000
			},
			subject: 'Confirm Stack project deletion',
			to: adminUser.email
		});
	}

	return { method, email: adminUser.email, projectName: target.name };
}

export async function deleteProjectWithVerification(params: DeleteProjectWithVerificationInput) {
	const { db, user: adminUser } = await requireAdminUser();
	const target = await requireLiveProject(db, params.projectId);

	await consumeAdminVerification(db, adminUser.id, params.projectId, params.method, params.code);
	await softDeleteOrganizationResources(db, params.projectId);
	captureServerEvent(
		'admin_project_deleted',
		{ verification_method: params.method },
		{ projectId: params.projectId }
	);

	return { projectId: params.projectId, name: target.name };
}

export async function getOrganizationResources(params: GetOrganizationResourcesInput) {
	const { db } = await requireAdminUser();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.orgId)
	});
	if (!target) {
		error(404, 'Organization not found');
	}

	const [vmsData, volumesData] = await Promise.all([
		db
			.select({
				id: vms.id,
				name: vms.name,
				status: vms.status,
				createdAt: vms.createdAt
			})
			.from(vms)
			.where(eq(vms.ownerProjectId, params.orgId))
			.orderBy(vms.name),
		db
			.select({
				id: volumes.id,
				name: volumes.name,
				size: volumes.size,
				createdAt: volumes.createdAt
			})
			.from(volumes)
			.where(eq(volumes.ownerProjectId, params.orgId))
			.orderBy(volumes.name)
	]);

	return { vms: vmsData, volumes: volumesData };
}
