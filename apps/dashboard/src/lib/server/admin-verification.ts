import { error } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { initAuth } from '$lib/server/auth';
import type { initDrizzle } from '$lib/server/db';
import { passkey, twoFactor, verification } from '$lib/server/db/schema';
import { ulid } from '$lib/server/id';

export const ADMIN_VERIFICATION_CODE_LENGTH = 6;
export const ADMIN_VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const ADMIN_VERIFICATION_INTENT_TTL_MS = 60 * 1000;

export type AdminVerificationMethod = 'passkey' | 'totp' | 'email';

type Db = ReturnType<typeof initDrizzle>;

function intentIdentifier(adminUserId: string) {
	return `admin-user-delete-intent:${adminUserId}`;
}

function passkeyIdentifier(adminUserId: string, targetId: string) {
	return `admin-user-delete-passkey:${adminUserId}:${targetId}`;
}

function emailIdentifier(adminUserId: string, targetId: string) {
	return `admin-user-delete-email:${adminUserId}:${targetId}`;
}

export function normalizeVerificationCode(code: string) {
	return code.replace(/\D/g, '');
}

function generateVerificationCode() {
	const max = 10 ** ADMIN_VERIFICATION_CODE_LENGTH;
	const value = crypto.getRandomValues(new Uint32Array(1))[0] % max;
	return value.toString().padStart(ADMIN_VERIFICATION_CODE_LENGTH, '0');
}

async function hashVerificationCode(adminUserId: string, targetId: string, code: string) {
	const data = new TextEncoder().encode(`${adminUserId}:${targetId}:${code}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getAdminVerificationMethod(
	db: Db,
	adminUserId: string
): Promise<AdminVerificationMethod> {
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

export async function beginAdminVerification(
	db: Db,
	adminUserId: string,
	targetId: string
): Promise<{ method: AdminVerificationMethod; code: string | null }> {
	const method = await getAdminVerificationMethod(db, adminUserId);

	await db.delete(verification).where(eq(verification.identifier, intentIdentifier(adminUserId)));

	if (method === 'passkey') {
		await db.insert(verification).values({
			id: ulid(),
			identifier: intentIdentifier(adminUserId),
			value: targetId,
			expiresAt: new Date(Date.now() + ADMIN_VERIFICATION_INTENT_TTL_MS)
		});
		return { method, code: null };
	}

	if (method === 'email') {
		const code = generateVerificationCode();
		const identifier = emailIdentifier(adminUserId, targetId);
		const value = await hashVerificationCode(adminUserId, targetId, code);

		await db.delete(verification).where(eq(verification.identifier, identifier));
		await db.insert(verification).values({
			id: ulid(),
			identifier,
			value,
			expiresAt: new Date(Date.now() + ADMIN_VERIFICATION_CODE_TTL_MS)
		});
		return { method, code };
	}

	return { method, code: null };
}

async function consumePasskeyVerification(db: Db, adminUserId: string, targetId: string) {
	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, passkeyIdentifier(adminUserId, targetId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!record) error(400, 'Verify with your passkey before performing this action.');
	await db.delete(verification).where(eq(verification.id, record.id));
}

async function consumeEmailVerification(
	db: Db,
	adminUserId: string,
	targetId: string,
	code: string
) {
	const normalizedCode = normalizeVerificationCode(code);
	if (normalizedCode.length !== ADMIN_VERIFICATION_CODE_LENGTH)
		error(400, 'Enter the verification code from your email.');

	const identifier = emailIdentifier(adminUserId, targetId);
	const value = await hashVerificationCode(adminUserId, targetId, normalizedCode);
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

export async function consumeAdminVerification(
	db: Db,
	adminUserId: string,
	targetId: string,
	method: string,
	code: string | undefined
) {
	const required = await getAdminVerificationMethod(db, adminUserId);
	if (method !== required) error(400, 'Use the required verification method for this account.');

	if (required === 'passkey') {
		await consumePasskeyVerification(db, adminUserId, targetId);
		return;
	}

	if (required === 'totp') {
		const normalizedCode = normalizeVerificationCode(code ?? '');
		if (normalizedCode.length !== ADMIN_VERIFICATION_CODE_LENGTH)
			error(400, 'Enter the verification code from your authenticator app.');

		const auth = initAuth();
		await auth.api.verifyTOTP({
			headers: getRequestEvent().request.headers,
			body: { code: normalizedCode, trustDevice: false }
		});
		return;
	}

	await consumeEmailVerification(db, adminUserId, targetId, code ?? '');
}
