import { error } from '@sveltejs/kit';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { initAuth } from '#lib/server/auth.js';
import { passkey, twoFactor, verification } from '#lib/server/db/auth.schema.js';
import type { initDrizzle } from '#lib/server/db/index.js';
import { ulid } from '#lib/server/id.js';
import { getRequestEvent } from '$app/server';

export const ADMIN_VERIFICATION_CODE_LENGTH = 6;
export const ADMIN_VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const ADMIN_VERIFICATION_INTENT_TTL_MS = 60 * 1000;
const ADMIN_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;
const USED_TOTP_CODE_TTL_MS = 2 * 60 * 1000;

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

function usedTotpIdentifier(adminUserId: string) {
	return `admin-totp-used:${adminUserId}`;
}

export function normalizeVerificationCode(code: string) {
	return code.replace(/\D/g, '');
}

function generateVerificationCode() {
	const max = 10 ** ADMIN_VERIFICATION_CODE_LENGTH;
	const upperBound = 0x1_00_00_00_00;
	const limit = Math.floor(upperBound / max) * max;
	let value: number;

	do {
		[value] = crypto.getRandomValues(new Uint32Array(1));
	} while (value >= limit);

	return (value % max).toString().padStart(ADMIN_VERIFICATION_CODE_LENGTH, '0');
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

	if (registeredPasskey) {
		return 'passkey';
	}

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

	return db.transaction(async (tx) => {
		await lockIdentifier(tx, intentIdentifier(adminUserId));
		await tx.delete(verification).where(eq(verification.identifier, intentIdentifier(adminUserId)));

		if (method === 'passkey') {
			await tx.insert(verification).values({
				id: ulid(),
				identifier: intentIdentifier(adminUserId),
				value: targetId,
				expiresAt: new Date(Date.now() + ADMIN_VERIFICATION_INTENT_TTL_MS)
			});
			return { method, code: null };
		}

		if (method === 'email') {
			const identifier = emailIdentifier(adminUserId, targetId);
			await lockIdentifier(tx, identifier);

			const now = Date.now();
			const [recent] = await tx
				.select({ id: verification.id })
				.from(verification)
				.where(
					and(
						eq(verification.identifier, identifier),
						gt(verification.expiresAt, new Date(now)),
						gt(verification.createdAt, new Date(now - ADMIN_VERIFICATION_RESEND_COOLDOWN_MS))
					)
				)
				.limit(1);
			if (recent) {
				return { method, code: null };
			}

			const code = generateVerificationCode();
			const value = await hashVerificationCode(adminUserId, targetId, code);

			await tx.delete(verification).where(eq(verification.identifier, identifier));
			await tx.insert(verification).values({
				id: ulid(),
				identifier,
				value,
				expiresAt: new Date(now + ADMIN_VERIFICATION_CODE_TTL_MS)
			});
			return { method, code };
		}

		return { method, code: null };
	});
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function lockIdentifier(tx: Tx, identifier: string) {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
}

async function consumePasskeyVerification(db: Db, adminUserId: string, targetId: string) {
	const consumed = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, passkeyIdentifier(adminUserId, targetId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.returning({ id: verification.id });

	if (consumed.length === 0) {
		error(400, 'Verify with your passkey before performing this action.');
	}
}

async function claimTotpCode(db: Db, adminUserId: string, code: string) {
	const identifier = usedTotpIdentifier(adminUserId);
	const id = `${identifier}:${await hashVerificationCode(adminUserId, 'totp', code)}`;
	const now = new Date();

	await db
		.delete(verification)
		.where(and(eq(verification.identifier, identifier), lte(verification.expiresAt, now)));
	const [claimed] = await db
		.insert(verification)
		.values({
			id,
			identifier,
			value: 'used',
			expiresAt: new Date(now.getTime() + USED_TOTP_CODE_TTL_MS)
		})
		.onConflictDoNothing()
		.returning({ id: verification.id });

	if (!claimed) {
		error(400, 'This verification code was already used. Wait for a new code.');
	}
}

async function consumeEmailVerification(
	db: Db,
	adminUserId: string,
	targetId: string,
	code: string
) {
	const normalizedCode = normalizeVerificationCode(code);
	if (normalizedCode.length !== ADMIN_VERIFICATION_CODE_LENGTH) {
		error(400, 'Enter the verification code from your email.');
	}

	const identifier = emailIdentifier(adminUserId, targetId);
	const value = await hashVerificationCode(adminUserId, targetId, normalizedCode);
	const consumed = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, identifier),
				eq(verification.value, value),
				gt(verification.expiresAt, new Date())
			)
		)
		.returning({ id: verification.id });

	if (consumed.length !== 1) {
		error(400, 'Invalid or expired verification code.');
	}
}

export async function consumeAdminVerification(
	db: Db,
	adminUserId: string,
	targetId: string,
	method: string,
	code: string | undefined
) {
	const required = await getAdminVerificationMethod(db, adminUserId);
	if (method !== required) {
		error(400, 'Use the required verification method for this account.');
	}

	if (required === 'passkey') {
		await consumePasskeyVerification(db, adminUserId, targetId);
		return;
	}

	if (required === 'totp') {
		const normalizedCode = normalizeVerificationCode(code ?? '');
		if (normalizedCode.length !== ADMIN_VERIFICATION_CODE_LENGTH) {
			error(400, 'Enter the verification code from your authenticator app.');
		}

		const auth = initAuth();
		await auth.api.verifyTOTP({
			headers: getRequestEvent().request.headers,
			body: { code: normalizedCode, trustDevice: false }
		});
		await claimTotpCode(db, adminUserId, normalizedCode);
		return;
	}

	await consumeEmailVerification(db, adminUserId, targetId, code ?? '');
}
