import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import AdminProjectDeletionCodeEmail from '$lib/emails/admin-project-deletion-code.svelte';
import {
	ADMIN_VERIFICATION_CODE_TTL_MS,
	beginAdminVerification,
	consumeAdminVerification
} from '$lib/server/admin-verification';
import { initAuth } from '$lib/server/auth';
import { requireAdmin } from '$lib/server/auth-context';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer,
	isProjectBillingExempt,
	requireProjectBillingActive
} from '$lib/server/billing/autumn';
import { initDrizzle } from '$lib/server/db';
import {
	member,
	organization,
	projectBillingCustomers,
	sshKeys,
	user,
	vms,
	volumes
} from '$lib/server/db/schema';
import { sendRenderedEmail } from '$lib/server/email';
import { softDeleteOrganizationResources } from '$lib/server/project-deletion';
import { provisionVm } from '$lib/server/vm-provisioning';

export type AdminProjectBillingStatus = 'configured' | 'past_due' | 'suspended' | 'none';

export type AdminProject = {
	id: string;
	name: string;
	slug: string;
	createdAt: number;
	ownerId: string | null;
	ownerName: string | null;
	ownerEmail: string | null;
	ownerBillingExempt: boolean;
	memberCount: number;
	vmCount: number;
	volumeCount: number;
	billingStatus: AdminProjectBillingStatus;
	billingExempt: boolean;
	disabled: boolean;
};

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

function makeCountMap(rows: { key: string | null; count: number }[]) {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (!row.key) continue;
		map.set(row.key, row.count);
	}
	return map;
}

export const listAdminProjects = query(async (): Promise<AdminProject[]> => {
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
		const billing = billingByProject.get(org.id);
		const billingStatus: AdminProjectBillingStatus = billing
			? billing.suspendedAt != null
				? 'suspended'
				: billing.pastDueSince != null
					? 'past_due'
					: 'configured'
			: 'none';

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
});

const setBillingExemptParams = type({ projectId: 'string', billingExempt: 'boolean' });
export const setProjectBillingExempt = command(setBillingExemptParams, async (params) => {
	const db = await requireCurrentAdmin();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) error(404, 'Project not found');

	await db
		.update(organization)
		.set({ billingExempt: params.billingExempt })
		.where(eq(organization.id, params.projectId));

	return { projectId: params.projectId, billingExempt: params.billingExempt };
});

function toSlug(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 42);

	return `${slug || 'project'}-${Date.now().toString(36)}`;
}

const createProjectParams = type({ name: 'string', ownerUserId: 'string' });
export const createAdminProject = command(createProjectParams, async (params) => {
	const db = await requireCurrentAdmin();

	const owner = await db.query.user.findFirst({ where: eq(user.id, params.ownerUserId) });
	if (!owner) error(404, 'User not found');

	const name = params.name.trim() || 'Untitled Project';
	const auth = initAuth();
	const org = await auth.api.createOrganization({
		body: {
			name,
			slug: toSlug(name),
			userId: params.ownerUserId
		}
	});
	if (!org) error(502, 'Failed to create project');

	await ensureLocalProjectBillingCustomer(org.id);
	ensureProjectCustomer(org.id).catch((err) => {
		console.warn(`Failed to sync Autumn customer for project ${org.id}`, err);
	});

	return { id: org.id };
});

const createVmParams = type({
	projectId: 'string',
	vmTypeId: 'string',
	name: 'string',
	networkingMode: "'both' | 'ipv6'?",
	imageId: 'string?',
	sshKeyIds: 'string[]?',
	password: 'string?'
});
export const createAdminVm = command(createVmParams, async (params) => {
	const db = await requireCurrentAdmin();
	const adminUser = getRequestEvent().locals.user;
	if (!adminUser) error(401, 'Authentication required');

	const project = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!project) error(404, 'Project not found');
	if (project.disabled) error(400, 'This project is disabled');

	const billingExempt = await isProjectBillingExempt(params.projectId);
	if (!billingExempt) await requireProjectBillingActive(params.projectId);

	const [owner] = await db
		.select({ userId: member.userId })
		.from(member)
		.where(and(eq(member.organizationId, params.projectId), eq(member.role, 'owner')))
		.limit(1);

	const keys =
		params.sshKeyIds?.length && owner
			? await db.query.sshKeys.findMany({ where: eq(sshKeys.userId, owner.userId) })
			: [];
	const publicKeys = params.sshKeyIds?.length
		? keys.filter((key) => params.sshKeyIds!.includes(key.id)).map((key) => key.publicKey)
		: [];

	return provisionVm(db, {
		projectId: params.projectId,
		vmTypeId: params.vmTypeId,
		name: params.name,
		userId: owner?.userId ?? adminUser.id,
		billingExempt,
		networkingMode: params.networkingMode,
		imageId: params.imageId,
		sshPublicKeys: publicKeys,
		password: params.password
	});
});

const setDisabledParams = type({ projectId: 'string', disabled: 'boolean' });
export const setProjectDisabled = command(setDisabledParams, async (params) => {
	const db = await requireCurrentAdmin();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) error(404, 'Project not found');

	await db
		.update(organization)
		.set({ disabled: params.disabled })
		.where(eq(organization.id, params.projectId));

	return { projectId: params.projectId, disabled: params.disabled };
});

const beginDeleteProjectParams = type({ projectId: 'string' });
export const beginDeleteProject = command(beginDeleteProjectParams, async (params) => {
	const db = await requireCurrentAdmin();
	const adminUser = getRequestEvent().locals.user;
	if (!adminUser) error(401, 'Authentication required');

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) error(404, 'Project not found');

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
});

const deleteProjectParams = type({ projectId: 'string', method: 'string', code: 'string?' });
export const deleteProjectWithVerification = command(deleteProjectParams, async (params) => {
	const db = await requireCurrentAdmin();
	const adminUser = getRequestEvent().locals.user;
	if (!adminUser) error(401, 'Authentication required');

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.projectId)
	});
	if (!target) error(404, 'Project not found');

	await consumeAdminVerification(db, adminUser.id, params.projectId, params.method, params.code);
	await softDeleteOrganizationResources(db, params.projectId);

	return { projectId: params.projectId, name: target.name };
});
