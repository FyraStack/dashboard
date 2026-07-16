import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, asc, count, desc, eq, gt, inArray } from 'drizzle-orm';
import AdminUserDeletionCodeEmail from '$lib/emails/admin-user-deletion-code.svelte';
import { hasAdminRole, requireAdmin } from '$lib/server/auth-context';
import { initAuth } from '$lib/server/auth';
import { initDrizzle } from '$lib/server/db';
import {
	account,
	apiTokens,
	invitation,
	ipAssignments,
	member,
	organization,
	passkey,
	paymentPeriods,
	session,
	sshKeys,
	twoFactor,
	user,
	verification,
	volumes,
	vms
} from '$lib/server/db/schema';
import { getBackend } from '$lib/server/backends';
import {
	cancelProjectBilling,
	deleteLocalProjectBillingCustomer,
	deleteProjectServerEntity,
	updateProjectCustomer
} from '$lib/server/billing/autumn';
import { meterResourceThrough, syncProjectUsage } from '$lib/server/billing/metering';
import { sendRenderedEmail } from '$lib/server/email';
import { ulid } from '$lib/server/id';
import { releaseVmNetworking } from '$lib/server/ipam';

const CODE_LENGTH = 6;
const USER_DELETE_CODE_TTL_MS = 10 * 60 * 1000;
const USER_DELETE_INTENT_TTL_MS = 60 * 1000;

type UserDeletionVerificationMethod = 'passkey' | 'totp' | 'email';

export type UserSession = {
	id: string;
	createdAt: Date;
	ipAddress: string | null;
	userAgent: string | null;
};

export type UserAccount = {
	id: string;
	providerId: string;
	accountId: string;
	createdAt: Date;
};

export type UserOrganization = {
	id: string;
	name: string;
	role: string;
};

export type UserSshKey = {
	id: string;
	name: string;
	fingerprint: string;
};

export type UserApiToken = {
	id: string;
	name: string;
	createdAt: number;
};

export type AdminUser = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	emailVerified: boolean;
	role: string | null;
	isAdmin: boolean;
	disabled: boolean;
	billingExempt: boolean;
	twoFactorEnabled: boolean;
	passkeyCount: number;
	createdAt: Date;
	updatedAt: Date;
	sessionCount: number;
	accountCount: number;
	orgCount: number;
	sshKeyCount: number;
	apiTokenCount: number;
};

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return { db, userId: event.locals.user.id };
}

function adminUserDeletionIntentIdentifier(adminUserId: string) {
	return `admin-user-delete-intent:${adminUserId}`;
}

function adminUserDeletionPasskeyIdentifier(adminUserId: string, targetUserId: string) {
	return `admin-user-delete-passkey:${adminUserId}:${targetUserId}`;
}

function adminUserDeletionEmailIdentifier(adminUserId: string, targetUserId: string) {
	return `admin-user-delete-email:${adminUserId}:${targetUserId}`;
}

function generateCode() {
	const max = 10 ** CODE_LENGTH;
	const value = crypto.getRandomValues(new Uint32Array(1))[0] % max;
	return value.toString().padStart(CODE_LENGTH, '0');
}

function normalizeCode(code: string) {
	return code.replace(/\D/g, '');
}

async function hashCode(adminUserId: string, targetUserId: string, code: string) {
	const data = new TextEncoder().encode(`${adminUserId}:${targetUserId}:${code}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getDeletionVerificationMethod(
	db: ReturnType<typeof initDrizzle>,
	adminUserId: string
): Promise<UserDeletionVerificationMethod> {
	const [registeredPasskey] = await db
		.select({ id: passkey.id })
		.from(passkey)
		.where(eq(passkey.userId, adminUserId))
		.limit(1);

	if (registeredPasskey) return 'passkey';

	const [registeredTotp] = await db
		.select({ id: twoFactor.id })
		.from(twoFactor)
		.where(eq(twoFactor.userId, adminUserId))
		.limit(1);

	return registeredTotp ? 'totp' : 'email';
}

async function assertCanDeleteUser(
	db: ReturnType<typeof initDrizzle>,
	adminUserId: string,
	targetUserId: string
) {
	if (adminUserId === targetUserId) error(400, 'You cannot delete your own account.');

	const target = await db.query.user.findFirst({ where: eq(user.id, targetUserId) });
	if (!target) error(404, 'User not found');

	if (hasAdminRole(target.role) || target.isAdmin) {
		const adminRows = await db.select({ role: user.role, isAdmin: user.isAdmin }).from(user);
		const adminCount = adminRows.filter(
			(account) => hasAdminRole(account.role) || account.isAdmin
		).length;
		if (adminCount <= 1) error(400, 'At least one admin is required.');
	}

	return target;
}

async function verifyDeletionEmailCode(
	db: ReturnType<typeof initDrizzle>,
	adminUserId: string,
	targetUserId: string,
	code: string
) {
	const normalizedCode = normalizeCode(code);
	if (normalizedCode.length !== CODE_LENGTH)
		error(400, 'Enter the verification code from your email.');

	const identifier = adminUserDeletionEmailIdentifier(adminUserId, targetUserId);
	const value = await hashCode(adminUserId, targetUserId, normalizedCode);
	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, identifier),
				eq(verification.value, value),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!record) error(400, 'Invalid or expired verification code.');
	await db.delete(verification).where(eq(verification.id, record.id));
}

async function verifyDeletionPasskey(
	db: ReturnType<typeof initDrizzle>,
	adminUserId: string,
	targetUserId: string
) {
	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, adminUserDeletionPasskeyIdentifier(adminUserId, targetUserId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!record) error(400, 'Verify with your passkey before deleting this user.');
	await db.delete(verification).where(eq(verification.id, record.id));
}

async function deleteUserData(db: ReturnType<typeof initDrizzle>, targetUserId: string) {
	await settleUserOrganizations(db, targetUserId);
	await db.delete(apiTokens).where(eq(apiTokens.userId, targetUserId));
	await db.delete(sshKeys).where(eq(sshKeys.userId, targetUserId));
	await db.delete(user).where(eq(user.id, targetUserId));
}

async function settleUserOrganizations(db: ReturnType<typeof initDrizzle>, targetUserId: string) {
	const memberships = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(eq(member.userId, targetUserId));

	for (const membership of memberships) {
		const otherMembers = await db
			.select({ id: member.id, userId: member.userId, createdAt: member.createdAt })
			.from(member)
			.where(eq(member.organizationId, membership.organizationId))
			.orderBy(asc(member.createdAt));
		const oldestRemainingMember = otherMembers.find((item) => item.userId !== targetUserId);

		if (oldestRemainingMember) {
			await db.update(member).set({ role: 'owner' }).where(eq(member.id, oldestRemainingMember.id));
			await updateProjectCustomer(membership.organizationId).catch((err) => {
				console.warn(
					`Failed to sync Autumn customer after ownership transfer for project ${membership.organizationId}`,
					err
				);
			});
			continue;
		}

		await deleteOrganizationResources(db, membership.organizationId);
	}
}

async function deleteOrganizationResources(
	db: ReturnType<typeof initDrizzle>,
	organizationId: string
) {
	const projectVms = await db.query.vms.findMany({
		where: eq(vms.ownerProjectId, organizationId),
		columns: {
			id: true,
			name: true,
			proxmoxId: true,
			active: true,
			backend: true
		}
	});
	const vmIds = projectVms.map((vm) => vm.id);

	for (const vm of projectVms.filter((item) => item.active)) {
		try {
			await getBackend(vm.backend).deleteVm(vm.id, vm.proxmoxId ?? undefined);
		} catch (err) {
			console.warn(`Failed to deprovision VM ${vm.id} during user delete`, err);
			error(502, `Failed to deprovision VM "${vm.name}" in Proxmox`);
		}
	}

	for (const vm of projectVms.filter((item) => item.active)) {
		const metered = await meterResourceThrough('vm', vm.id).catch((err) => {
			console.warn(`Failed to meter VM ${vm.id} during user delete`, err);
			error(502, `Failed to meter VM "${vm.name}" during user delete`);
		});
		if (!metered?.event || metered.syncStatus === 'synced') {
			await deleteProjectServerEntity(organizationId, vm.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${vm.id}`, err);
			});
		}
	}
	await syncProjectUsage(organizationId);

	await db.delete(volumes).where(eq(volumes.ownerProjectId, organizationId));
	for (const vm of projectVms) {
		await releaseVmNetworking(db, vm.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${vm.id} during user delete`, err);
		});
	}
	if (vmIds.length > 0) {
		await db.delete(ipAssignments).where(inArray(ipAssignments.associatedVmId, vmIds));
		await db.delete(paymentPeriods).where(inArray(paymentPeriods.vmId, vmIds));
	}
	await db.delete(vms).where(eq(vms.ownerProjectId, organizationId));
	await db.delete(invitation).where(eq(invitation.organizationId, organizationId));
	await db.delete(member).where(eq(member.organizationId, organizationId));
	const billingCancelled = await cancelProjectBilling(organizationId).catch((err) => {
		console.warn(`Failed to cancel Autumn billing for project ${organizationId}`, err);
		return false;
	});
	if (billingCancelled) {
		await deleteLocalProjectBillingCustomer(organizationId);
	}
	await db.delete(organization).where(eq(organization.id, organizationId));
}

function makeCountMap(rows: { userId: string | null; count: number }[]) {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (!row.userId) continue;
		map.set(row.userId, row.count);
	}
	return map;
}

export const listAdminUsers = query(async (): Promise<AdminUser[]> => {
	const { db } = await requireCurrentAdmin();

	const users = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			emailVerified: user.emailVerified,
			role: user.role,
			legacyIsAdmin: user.isAdmin,
			disabled: user.banned,
			billingExempt: user.billingExempt,
			twoFactorEnabled: user.twoFactorEnabled,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt
		})
		.from(user)
		.orderBy(desc(user.createdAt));

	const [sessions, accounts, members, sshKeysData, apiTokensData, passkeysData] = await Promise.all(
		[
			db.select({ userId: session.userId, count: count() }).from(session).groupBy(session.userId),
			db.select({ userId: account.userId, count: count() }).from(account).groupBy(account.userId),
			db.select({ userId: member.userId, count: count() }).from(member).groupBy(member.userId),
			db.select({ userId: sshKeys.userId, count: count() }).from(sshKeys).groupBy(sshKeys.userId),
			db
				.select({ userId: apiTokens.userId, count: count() })
				.from(apiTokens)
				.groupBy(apiTokens.userId),
			db.select({ userId: passkey.userId, count: count() }).from(passkey).groupBy(passkey.userId)
		]
	);

	const sessionMap = makeCountMap(sessions);
	const accountMap = makeCountMap(accounts);
	const memberMap = makeCountMap(members);
	const sshKeyMap = makeCountMap(sshKeysData);
	const apiTokenMap = makeCountMap(apiTokensData);
	const passkeyMap = makeCountMap(passkeysData);

	return users.map(({ legacyIsAdmin, role, ...account }) => ({
		...account,
		role,
		disabled: account.disabled ?? false,
		billingExempt: account.billingExempt ?? false,
		twoFactorEnabled: account.twoFactorEnabled ?? false,
		passkeyCount: passkeyMap.get(account.id) ?? 0,
		isAdmin: hasAdminRole(role) || legacyIsAdmin,
		sessionCount: sessionMap.get(account.id) ?? 0,
		accountCount: accountMap.get(account.id) ?? 0,
		orgCount: memberMap.get(account.id) ?? 0,
		sshKeyCount: sshKeyMap.get(account.id) ?? 0,
		apiTokenCount: apiTokenMap.get(account.id) ?? 0
	}));
});

const setAdminParams = type({ userId: 'string', isAdmin: 'boolean' });
export const setUserAdmin = command(setAdminParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	if (!params.isAdmin && (hasAdminRole(target.role) || target.isAdmin)) {
		const adminRows = await db.select({ role: user.role, isAdmin: user.isAdmin }).from(user);
		const adminCount = adminRows.filter((row) => hasAdminRole(row.role) || row.isAdmin).length;
		if (adminCount <= 1) error(400, 'At least one admin is required');
	}

	await db
		.update(user)
		.set({ role: params.isAdmin ? 'admin' : 'user', isAdmin: params.isAdmin })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, isAdmin: params.isAdmin };
});

const setDisabledParams = type({ userId: 'string', disabled: 'boolean' });
export const setUserDisabled = command(setDisabledParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	await db
		.update(user)
		.set({ banned: params.disabled, banReason: params.disabled ? null : target.banReason })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, disabled: params.disabled };
});

const setBillingExemptParams = type({ userId: 'string', billingExempt: 'boolean' });
export const setUserBillingExempt = command(setBillingExemptParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	await db
		.update(user)
		.set({ billingExempt: params.billingExempt })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, billingExempt: params.billingExempt };
});

const setTwoFactorParams = type({ userId: 'string', twoFactorEnabled: 'boolean' });
export const setUserTwoFactor = command(setTwoFactorParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	await db
		.update(user)
		.set({ twoFactorEnabled: params.twoFactorEnabled })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, twoFactorEnabled: params.twoFactorEnabled };
});

const setRoleParams = type({ userId: 'string', role: 'string' });
export const setUserRole = command(setRoleParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	await db
		.update(user)
		.set({ role: params.role, isAdmin: hasAdminRole(params.role) })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, role: params.role, isAdmin: hasAdminRole(params.role) };
});

const beginDeleteUserParams = type({ userId: 'string' });
export const beginDeleteUser = command(beginDeleteUserParams, async (params) => {
	const { db, userId: adminUserId } = await requireCurrentAdmin();
	const adminUser = getRequestEvent().locals.user;
	if (!adminUser) error(401, 'Authentication required');

	const target = await assertCanDeleteUser(db, adminUserId, params.userId);
	const method = await getDeletionVerificationMethod(db, adminUserId);

	await db
		.delete(verification)
		.where(eq(verification.identifier, adminUserDeletionIntentIdentifier(adminUserId)));

	if (method === 'passkey') {
		await db.insert(verification).values({
			id: ulid(),
			identifier: adminUserDeletionIntentIdentifier(adminUserId),
			value: params.userId,
			expiresAt: new Date(Date.now() + USER_DELETE_INTENT_TTL_MS)
		});
	} else if (method === 'email') {
		const code = generateCode();
		const identifier = adminUserDeletionEmailIdentifier(adminUserId, params.userId);
		const value = await hashCode(adminUserId, params.userId, code);

		await db.delete(verification).where(eq(verification.identifier, identifier));
		await db.insert(verification).values({
			id: ulid(),
			identifier,
			value,
			expiresAt: new Date(Date.now() + USER_DELETE_CODE_TTL_MS)
		});

		await sendRenderedEmail({
			component: AdminUserDeletionCodeEmail,
			props: {
				userName: adminUser.name,
				targetEmail: target.email,
				code,
				expiresInMinutes: USER_DELETE_CODE_TTL_MS / 60_000
			},
			subject: 'Confirm Stack user deletion',
			to: adminUser.email
		});
	}

	return { method, email: adminUser.email, targetEmail: target.email, targetName: target.name };
});

const deleteUserParams = type({ userId: 'string', method: 'string', code: 'string?' });
export const deleteUserWithVerification = command(deleteUserParams, async (params) => {
	const { db, userId: adminUserId } = await requireCurrentAdmin();
	const target = await assertCanDeleteUser(db, adminUserId, params.userId);
	const method = await getDeletionVerificationMethod(db, adminUserId);

	if (params.method !== method)
		error(400, 'Use the required verification method for this account.');

	if (method === 'passkey') {
		await verifyDeletionPasskey(db, adminUserId, params.userId);
	} else if (method === 'totp') {
		const code = normalizeCode(params.code ?? '');
		if (code.length !== CODE_LENGTH)
			error(400, 'Enter the verification code from your authenticator app.');

		const auth = initAuth();
		await auth.api.verifyTOTP({
			headers: getRequestEvent().request.headers,
			body: { code, trustDevice: false }
		});
	} else {
		await verifyDeletionEmailCode(db, adminUserId, params.userId, params.code ?? '');
	}

	await deleteUserData(db, params.userId);

	return { userId: params.userId, email: target.email };
});

const getUserResourcesParams = type({ userId: 'string' });
export const getUserResources = query(getUserResourcesParams, async (params) => {
	const { db } = await requireCurrentAdmin();

	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) error(404, 'User not found');

	const [sessions, accounts, members, sshKeysList, apiTokenList] = await Promise.all([
		db
			.select({
				id: session.id,
				createdAt: session.createdAt,
				ipAddress: session.ipAddress,
				userAgent: session.userAgent
			})
			.from(session)
			.where(eq(session.userId, params.userId)),
		db
			.select({
				id: account.id,
				providerId: account.providerId,
				accountId: account.accountId,
				createdAt: account.createdAt
			})
			.from(account)
			.where(eq(account.userId, params.userId)),
		db
			.select({
				id: organization.id,
				name: organization.name,
				role: member.role
			})
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(eq(member.userId, params.userId)),
		db
			.select({ id: sshKeys.id, name: sshKeys.name, fingerprint: sshKeys.fingerprint })
			.from(sshKeys)
			.where(eq(sshKeys.userId, params.userId)),
		db
			.select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt })
			.from(apiTokens)
			.where(eq(apiTokens.userId, params.userId))
	]);

	return { sessions, accounts, members, sshKeys: sshKeysList, apiTokens: apiTokenList };
});

const getOrgResourcesParams = type({ orgId: 'string' });
export const getOrganizationResources = query(getOrgResourcesParams, async (params) => {
	const { db } = await requireCurrentAdmin();

	const target = await db.query.organization.findFirst({
		where: eq(organization.id, params.orgId)
	});
	if (!target) error(404, 'Organization not found');

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
});
