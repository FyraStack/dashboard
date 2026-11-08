import { and, count, desc, eq, isNull } from 'drizzle-orm';
import AdminProjectDeletionCodeEmail from '#lib/emails/admin-project-deletion-code.svelte';
import {
	ADMIN_VERIFICATION_CODE_TTL_MS,
	beginAdminVerification,
	consumeAdminVerification
} from '#lib/server/admin-verification.js';
import { initAuth } from '#lib/server/auth.js';
import { requireAdmin } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer,
	isProjectBillingExempt,
	requireProjectBillingActive
} from '#lib/server/billing/autumn.js';
import { context } from '#lib/server/context.js';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers, sshKeys, vms, volumes } from '#lib/server/db/schema.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { softDeleteOrganizationResources } from '#lib/server/project-deletion.js';
import { provisionVm } from '#lib/server/vm-provisioning.js';

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

export interface CreateAdminVmInput {
	idempotencyKey: string;
	imageId?: string;
	name: string;
	networkingMode?: 'both' | 'ipv6';
	password?: string;
	projectId: string;
	sshKeyIds?: string[];
	vmTypeId: string;
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
	method: string;
	projectId: string;
}

async function requireCurrentAdmin() {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, locals.user.id);

	return db;
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

function makeCountMap(rows: { key: string | null; count: number }[]) {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (!row.key) {
			continue;
		}
		map.set(row.key, row.count);
	}
	return map;
}

export async function listAdminProjects(): Promise<AdminProject[]> {
	const db = await requireCurrentAdmin();

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
	const db = await requireCurrentAdmin();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) {
		error(404, 'Project not found');
	}

	await db
		.update(organization)
		.set({ billingExempt: params.billingExempt })
		.where(eq(organization.id, params.projectId));

	return { projectId: params.projectId, billingExempt: params.billingExempt };
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

export async function createAdminProject(params: CreateAdminProjectInput) {
	const db = await requireCurrentAdmin();
	const adminUser = context().locals.user;
	if (!adminUser) {
		error(401, 'Authentication required');
	}

	const owner = await db.query.user.findFirst({ where: eq(user.id, params.ownerUserId) });
	if (!owner) {
		error(404, 'User not found');
	}

	const name = params.name.trim() || 'Untitled Project';
	return withIdempotency(
		db,
		{
			key: params.idempotencyKey,
			operation: 'admin.createProject',
			args: { name, ownerUserId: params.ownerUserId, userId: adminUser.id }
		},
		async () => {
			const auth = initAuth();
			const org = await auth.api.createOrganization({
				body: {
					name,
					slug: toSlug(name),
					userId: params.ownerUserId
				}
			});
			if (!org) {
				error(502, 'Failed to create project');
			}

			await ensureLocalProjectBillingCustomer(org.id);
			runInBackground(
				ensureProjectCustomer(org.id).catch((err) => {
					console.warn(`Failed to sync Autumn customer for project ${org.id}`, err);
				}),
				`sync autumn customer for project ${org.id}`
			);

			return { id: org.id };
		}
	);
}

export async function createAdminVm(params: CreateAdminVmInput) {
	const db = await requireCurrentAdmin();
	const adminUser = context().locals.user;
	if (!adminUser) {
		error(401, 'Authentication required');
	}

	const project = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!project) {
		error(404, 'Project not found');
	}
	if (project.disabled) {
		error(400, 'This project is disabled');
	}

	const billingExempt = await isProjectBillingExempt(params.projectId);
	if (!billingExempt) {
		await requireProjectBillingActive(params.projectId);
	}

	const [owner] = await db
		.select({ userId: member.userId })
		.from(member)
		.where(and(eq(member.organizationId, params.projectId), eq(member.role, 'owner')))
		.limit(1);

	const sshKeyIds = params.sshKeyIds ?? [];
	const keys =
		sshKeyIds.length > 0 && owner
			? await db.query.sshKeys.findMany({ where: eq(sshKeys.userId, owner.userId) })
			: [];
	const publicKeys = keys.filter((key) => sshKeyIds.includes(key.id)).map((key) => key.publicKey);

	const { idempotencyKey, ...operationArgs } = params;
	return withIdempotency(
		db,
		{
			key: idempotencyKey,
			operation: 'admin.createVm',
			args: { ...operationArgs, userId: adminUser.id, sshKeyIds: [...sshKeyIds].sort() }
		},
		() =>
			provisionVm(db, {
				projectId: params.projectId,
				vmTypeId: params.vmTypeId,
				name: params.name,
				userId: owner?.userId ?? adminUser.id,
				billingExempt,
				networkingMode: params.networkingMode,
				imageId: params.imageId,
				sshPublicKeys: publicKeys,
				password: params.password
			})
	);
}

export async function setProjectDisabled(params: SetProjectDisabledInput) {
	const db = await requireCurrentAdmin();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) {
		error(404, 'Project not found');
	}

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
	const db = await requireCurrentAdmin();
	const adminUser = context().locals.user;
	if (!adminUser) {
		error(401, 'Authentication required');
	}

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) {
		error(404, 'Project not found');
	}

	const { method, code } = await beginAdminVerification(db, adminUser.id, params.projectId);

	if (code) {
		await sendRenderedEmail({
			component: AdminProjectDeletionCodeEmail,
			props: {
				userName: adminUser.name,
				projectName: target.name,
				code,
				expiresInMinutes: ADMIN_VERIFICATION_CODE_TTL_MS / 60_000
			},
			subject: 'Confirm Stack project deletion',
			to: adminUser.email
		});
	}

	return { method, email: adminUser.email, projectName: target.name };
}

export async function deleteProjectWithVerification(params: DeleteProjectWithVerificationInput) {
	const db = await requireCurrentAdmin();
	const adminUser = context().locals.user;
	if (!adminUser) {
		error(401, 'Authentication required');
	}

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) {
		error(404, 'Project not found');
	}

	await consumeAdminVerification(db, adminUser.id, params.projectId, params.method, params.code);
	await softDeleteOrganizationResources(db, params.projectId);
	captureServerEvent(
		'admin_project_deleted',
		{ verification_method: params.method },
		{ projectId: params.projectId }
	);

	return { projectId: params.projectId, name: target.name };
}
