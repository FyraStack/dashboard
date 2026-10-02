import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { asc, count, desc, eq } from 'drizzle-orm';
import AdminUserDeletionCodeEmail from '#lib/emails/admin-user-deletion-code.svelte';
import {
	accessibilityFixtureAdminUsers,
	accessibilityFixtureEnabled
} from '#lib/server/accessibility-fixtures.js';
import {
	ADMIN_VERIFICATION_CODE_TTL_MS,
	beginAdminVerification,
	consumeAdminVerification
} from '#lib/server/admin-verification.js';
import { hasAdminRole, requireAdmin } from '#lib/server/auth-context.js';
import { updateProjectCustomer } from '#lib/server/billing/autumn.js';
import {
	account,
	member,
	organization,
	passkey,
	session,
	user
} from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { apiTokens, sshKeys, vms, volumes } from '#lib/server/db/schema.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { softDeleteOrganizationResources } from '#lib/server/project-deletion.js';
import { command, getRequestEvent, query } from '$app/server';

export interface UserSession {
	createdAt: Date;
	id: string;
	ipAddress: string | null;
	userAgent: string | null;
}

export interface UserAccount {
	accountId: string;
	createdAt: Date;
	id: string;
	providerId: string;
}

export interface UserOrganization {
	id: string;
	name: string;
	role: string;
}

export interface UserSshKey {
	fingerprint: string;
	id: string;
	name: string;
}

export interface UserApiToken {
	createdAt: number;
	id: string;
	name: string;
}

export interface AdminUser {
	accountCount: number;
	apiTokenCount: number;
	billingExempt: boolean;
	createdAt: Date;
	disabled: boolean;
	email: string;
	emailVerified: boolean;
	id: string;
	image: string | null;
	isAdmin: boolean;
	name: string;
	orgCount: number;
	passkeyCount: number;
	role: string | null;
	sessionCount: number;
	sshKeyCount: number;
	twoFactorEnabled: boolean;
	updatedAt: Date;
}

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return { db, userId: event.locals.user.id };
}

async function assertCanDeleteUser(
	db: ReturnType<typeof initDrizzle>,
	adminUserId: string,
	targetUserId: string
) {
	if (adminUserId === targetUserId) {
		error(400, 'You cannot delete your own account.');
	}

	const target = await db.query.user.findFirst({ where: eq(user.id, targetUserId) });
	if (!target) {
		error(404, 'User not found');
	}

	if (hasAdminRole(target.role) || target.isAdmin) {
		const adminRows = await db.select({ role: user.role, isAdmin: user.isAdmin }).from(user);
		const adminCount = adminRows.filter((row) => hasAdminRole(row.role) || row.isAdmin).length;
		if (adminCount <= 1) {
			error(400, 'At least one admin is required.');
		}
	}

	return target;
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
		// biome-ignore lint/performance/noAwaitInLoops: each organization settlement syncs Autumn and tears down backend resources, so run them one at a time
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

		await softDeleteOrganizationResources(db, membership.organizationId);
	}
}

function makeCountMap(rows: { userId: string | null; count: number }[]) {
	const map = new Map<string, number>();
	for (const row of rows) {
		if (!row.userId) {
			continue;
		}
		map.set(row.userId, row.count);
	}
	return map;
}

export const listAdminUsers = query(async (): Promise<AdminUser[]> => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureAdminUsers;
	}
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

	return users.map(({ legacyIsAdmin, role, ...userRow }) => ({
		...userRow,
		role,
		disabled: userRow.disabled ?? false,
		billingExempt: userRow.billingExempt ?? false,
		twoFactorEnabled: userRow.twoFactorEnabled ?? false,
		passkeyCount: passkeyMap.get(userRow.id) ?? 0,
		isAdmin: hasAdminRole(role) || legacyIsAdmin,
		sessionCount: sessionMap.get(userRow.id) ?? 0,
		accountCount: accountMap.get(userRow.id) ?? 0,
		orgCount: memberMap.get(userRow.id) ?? 0,
		sshKeyCount: sshKeyMap.get(userRow.id) ?? 0,
		apiTokenCount: apiTokenMap.get(userRow.id) ?? 0
	}));
});

const setAdminParams = type({ userId: 'string', isAdmin: 'boolean' });
export const setUserAdmin = command(setAdminParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) {
		error(404, 'User not found');
	}

	if (!params.isAdmin && (hasAdminRole(target.role) || target.isAdmin)) {
		const adminRows = await db.select({ role: user.role, isAdmin: user.isAdmin }).from(user);
		const adminCount = adminRows.filter((row) => hasAdminRole(row.role) || row.isAdmin).length;
		if (adminCount <= 1) {
			error(400, 'At least one admin is required');
		}
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
	if (!target) {
		error(404, 'User not found');
	}

	await db
		.update(user)
		.set({ banned: params.disabled, banReason: params.disabled ? null : target.banReason })
		.where(eq(user.id, params.userId));

	captureServerEvent('admin_user_disabled_changed', {
		target_user_id: params.userId,
		disabled: params.disabled
	});

	return { userId: params.userId, disabled: params.disabled };
});

const setBillingExemptParams = type({ userId: 'string', billingExempt: 'boolean' });
export const setUserBillingExempt = command(setBillingExemptParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) {
		error(404, 'User not found');
	}

	await db
		.update(user)
		.set({ billingExempt: params.billingExempt })
		.where(eq(user.id, params.userId));

	captureServerEvent('admin_user_billing_exempt_changed', {
		target_user_id: params.userId,
		billing_exempt: params.billingExempt
	});

	return { userId: params.userId, billingExempt: params.billingExempt };
});

const setTwoFactorParams = type({ userId: 'string', twoFactorEnabled: 'boolean' });
export const setUserTwoFactor = command(setTwoFactorParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) {
		error(404, 'User not found');
	}

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
	if (!target) {
		error(404, 'User not found');
	}

	await db
		.update(user)
		.set({ role: params.role, isAdmin: hasAdminRole(params.role) })
		.where(eq(user.id, params.userId));

	captureServerEvent('admin_user_role_changed', {
		target_user_id: params.userId,
		role: params.role
	});

	return { userId: params.userId, role: params.role, isAdmin: hasAdminRole(params.role) };
});

const beginDeleteUserParams = type({ userId: 'string' });
export const beginDeleteUser = command(beginDeleteUserParams, async (params) => {
	const { db, userId: adminUserId } = await requireCurrentAdmin();
	const adminUser = getRequestEvent().locals.user;
	if (!adminUser) {
		error(401, 'Authentication required');
	}

	const target = await assertCanDeleteUser(db, adminUserId, params.userId);
	const { method, code } = await beginAdminVerification(db, adminUserId, params.userId);

	if (code) {
		await sendRenderedEmail({
			component: AdminUserDeletionCodeEmail,
			props: {
				userName: adminUser.name,
				targetEmail: target.email,
				code,
				expiresInMinutes: ADMIN_VERIFICATION_CODE_TTL_MS / 60_000
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

	await consumeAdminVerification(db, adminUserId, params.userId, params.method, params.code);
	await deleteUserData(db, params.userId);
	captureServerEvent('admin_user_deleted', {
		target_user_id: params.userId,
		verification_method: params.method
	});

	return { userId: params.userId, email: target.email };
});

const getUserResourcesParams = type({ userId: 'string' });
export const getUserResources = query(getUserResourcesParams, async (params) => {
	const { db } = await requireCurrentAdmin();

	const target = await db.query.user.findFirst({ where: eq(user.id, params.userId) });
	if (!target) {
		error(404, 'User not found');
	}

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
});
