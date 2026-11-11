import { and, asc, count, desc, eq, ne, or, sql } from 'drizzle-orm';
import type { VerificationMethod } from 'stack-shared/auth';
import AdminUserDeletionCodeEmail from '#lib/emails/admin-user-deletion-code.svelte';
import {
	beginAdminVerification,
	consumeAdminVerification
} from '#lib/server/admin-verification.js';
import { isAdminUser, requireAdminUser } from '#lib/server/auth-context.js';
import { updateProjectCustomer } from '#lib/server/billing/customers.js';
import { makeCountMap } from '#lib/server/count-map.js';
import {
	account,
	member,
	organization,
	passkey,
	session,
	user
} from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { apiTokens, sshKeys } from '#lib/server/db/schema.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { softDeleteOrganizationResources } from '#lib/server/project-deletion.js';
import { VERIFICATION_CODE_TTL_MS } from '#lib/server/verification-codes.js';

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

export interface SetUserAdminInput {
	isAdmin: boolean;
	userId: string;
}

export interface SetUserDisabledInput {
	disabled: boolean;
	userId: string;
}

export interface SetUserBillingExemptInput {
	billingExempt: boolean;
	userId: string;
}

export interface SetUserTwoFactorInput {
	twoFactorEnabled: boolean;
	userId: string;
}

export interface BeginDeleteUserInput {
	userId: string;
}

export interface DeleteUserWithVerificationInput {
	code?: string;
	method: VerificationMethod;
	userId: string;
}

export interface GetUserResourcesInput {
	userId: string;
}

const adminUserCondition = or(
	eq(user.isAdmin, true),
	sql`'admin' = any(string_to_array(${user.role}, ','))`
);

async function requireUserRecord(db: Database, userId: string) {
	const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
	if (!target) {
		error(404, 'User not found');
	}
	return target;
}

async function assertAnotherAdminExists(
	db: Database,
	target: { role: string | null; isAdmin: boolean | null }
) {
	if (!isAdminUser(target)) {
		return;
	}

	const [{ adminCount }] = await db
		.select({ adminCount: count() })
		.from(user)
		.where(adminUserCondition);
	if (adminCount <= 1) {
		error(400, 'At least one admin is required.');
	}
}

async function assertCanDeleteUser(db: Database, adminUserId: string, targetUserId: string) {
	if (adminUserId === targetUserId) {
		error(400, 'You cannot delete your own account.');
	}

	const target = await requireUserRecord(db, targetUserId);
	await assertAnotherAdminExists(db, target);
	return target;
}

async function deleteUserData(db: Database, targetUserId: string) {
	await settleUserOrganizations(db, targetUserId);
	await db.delete(apiTokens).where(eq(apiTokens.userId, targetUserId));
	await db.delete(sshKeys).where(eq(sshKeys.userId, targetUserId));
	await db.delete(user).where(eq(user.id, targetUserId));
}

async function settleUserOrganizations(db: Database, targetUserId: string) {
	const ownedProjects = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(and(eq(member.userId, targetUserId), eq(member.role, 'owner')));

	for (const { organizationId } of ownedProjects) {
		// biome-ignore lint/performance/noAwaitInLoops: each organization settlement syncs Autumn and tears down backend resources, so run them one at a time
		const [successor] = await db
			.select({ id: member.id })
			.from(member)
			.where(and(eq(member.organizationId, organizationId), ne(member.userId, targetUserId)))
			.orderBy(asc(member.createdAt))
			.limit(1);

		if (!successor) {
			await softDeleteOrganizationResources(db, organizationId);
			continue;
		}

		await db.update(member).set({ role: 'owner' }).where(eq(member.id, successor.id));
		await updateProjectCustomer(organizationId).catch((err) => {
			console.warn(
				`Failed to sync Autumn customer after ownership transfer for project ${organizationId}`,
				err
			);
		});
	}
}

async function updateUserRole(db: Database, userId: string, role: 'admin' | 'user') {
	const target = await requireUserRecord(db, userId);
	const isAdmin = role === 'admin';
	if (!isAdmin) {
		await assertAnotherAdminExists(db, target);
	}

	await db.update(user).set({ role, isAdmin }).where(eq(user.id, userId));
	return isAdmin;
}

export async function listAdminUsers(): Promise<AdminUser[]> {
	const { db } = await requireAdminUser();

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
			db.select({ key: session.userId, count: count() }).from(session).groupBy(session.userId),
			db.select({ key: account.userId, count: count() }).from(account).groupBy(account.userId),
			db.select({ key: member.userId, count: count() }).from(member).groupBy(member.userId),
			db.select({ key: sshKeys.userId, count: count() }).from(sshKeys).groupBy(sshKeys.userId),
			db
				.select({ key: apiTokens.userId, count: count() })
				.from(apiTokens)
				.groupBy(apiTokens.userId),
			db.select({ key: passkey.userId, count: count() }).from(passkey).groupBy(passkey.userId)
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
		isAdmin: isAdminUser({ role, isAdmin: legacyIsAdmin }),
		sessionCount: sessionMap.get(userRow.id) ?? 0,
		accountCount: accountMap.get(userRow.id) ?? 0,
		orgCount: memberMap.get(userRow.id) ?? 0,
		sshKeyCount: sshKeyMap.get(userRow.id) ?? 0,
		apiTokenCount: apiTokenMap.get(userRow.id) ?? 0
	}));
}

export async function setUserAdmin(params: SetUserAdminInput) {
	const { db } = await requireAdminUser();
	await updateUserRole(db, params.userId, params.isAdmin ? 'admin' : 'user');

	return { userId: params.userId, isAdmin: params.isAdmin };
}

export async function setUserDisabled(params: SetUserDisabledInput) {
	const { db } = await requireAdminUser();
	const target = await requireUserRecord(db, params.userId);

	await db
		.update(user)
		.set({ banned: params.disabled, banReason: params.disabled ? null : target.banReason })
		.where(eq(user.id, params.userId));
	if (params.disabled) {
		await db.delete(session).where(eq(session.userId, params.userId));
	}

	captureServerEvent('admin_user_disabled_changed', {
		target_user_id: params.userId,
		disabled: params.disabled
	});

	return { userId: params.userId, disabled: params.disabled };
}

export async function setUserBillingExempt(params: SetUserBillingExemptInput) {
	const { db } = await requireAdminUser();
	await requireUserRecord(db, params.userId);

	await db
		.update(user)
		.set({ billingExempt: params.billingExempt })
		.where(eq(user.id, params.userId));

	captureServerEvent('admin_user_billing_exempt_changed', {
		target_user_id: params.userId,
		billing_exempt: params.billingExempt
	});

	return { userId: params.userId, billingExempt: params.billingExempt };
}

export async function setUserTwoFactor(params: SetUserTwoFactorInput) {
	const { db } = await requireAdminUser();
	await requireUserRecord(db, params.userId);

	await db
		.update(user)
		.set({ twoFactorEnabled: params.twoFactorEnabled })
		.where(eq(user.id, params.userId));

	return { userId: params.userId, twoFactorEnabled: params.twoFactorEnabled };
}

export async function beginDeleteUser(params: BeginDeleteUserInput) {
	const { db, user: adminUser } = await requireAdminUser();

	const target = await assertCanDeleteUser(db, adminUser.id, params.userId);
	const { method, code } = await beginAdminVerification(db, adminUser.id, params.userId);

	if (code) {
		await sendRenderedEmail({
			component: AdminUserDeletionCodeEmail,
			props: {
				userName: adminUser.name,
				targetEmail: target.email,
				code,
				expiresInMinutes: VERIFICATION_CODE_TTL_MS / 60_000
			},
			subject: 'Confirm Stack user deletion',
			to: adminUser.email
		});
	}

	return { method, email: adminUser.email, targetEmail: target.email, targetName: target.name };
}

export async function deleteUserWithVerification(params: DeleteUserWithVerificationInput) {
	const { db, user: adminUser } = await requireAdminUser();
	const target = await assertCanDeleteUser(db, adminUser.id, params.userId);

	await consumeAdminVerification(db, adminUser.id, params.userId, params.method, params.code);
	await deleteUserData(db, params.userId);
	captureServerEvent('admin_user_deleted', {
		target_user_id: params.userId,
		verification_method: params.method
	});

	return { userId: params.userId, email: target.email };
}

export async function getUserResources(params: GetUserResourcesInput) {
	const { db } = await requireAdminUser();

	await requireUserRecord(db, params.userId);

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
}
