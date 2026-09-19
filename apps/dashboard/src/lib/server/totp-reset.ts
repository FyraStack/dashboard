import { error } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { twoFactor, verification } from './db/auth.schema';
import type { initDrizzle } from './db';
import { ulid } from './id';

export const TOTP_RESET_CODE_LENGTH = 6;
export const TOTP_RESET_CODE_TTL_MS = 10 * 60 * 1000;
export const TOTP_RESET_GRANT_TTL_MS = 10 * 60 * 1000;

export type TotpResetChoice = 'reset' | 'disable';

type Db = ReturnType<typeof initDrizzle>;

export function normalizeTotpResetChoice(value: string): TotpResetChoice | null {
	if (value === 'reset' || value === 'reset-totp') return 'reset';
	if (value === 'disable' || value === 'disable-totp') return 'disable';
	return null;
}

export function normalizeTotpResetCode(code: string) {
	return code.replace(/\D/g, '');
}

export function totpResetCodeIdentifier(userId: string) {
	return `totp-reset:${userId}`;
}

export function totpResetGrantIdentifier(userId: string) {
	return `totp-reset-verified:${userId}`;
}

export function generateTotpResetCode() {
	const max = 10 ** TOTP_RESET_CODE_LENGTH;
	const range = 2 ** 32;
	const limit = range - (range % max);
	const values = new Uint32Array(1);

	do {
		crypto.getRandomValues(values);
	} while (values[0] >= limit);

	return (values[0] % max).toString().padStart(TOTP_RESET_CODE_LENGTH, '0');
}

export async function hashTotpResetCode(userId: string, code: string) {
	const data = new TextEncoder().encode(`${userId}:${code}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function requireExistingTotp(db: Db, userId: string) {
	const [registeredTotp] = await db
		.select({ id: twoFactor.id })
		.from(twoFactor)
		.where(eq(twoFactor.userId, userId))
		.limit(1);

	if (!registeredTotp)
		error(400, 'Authenticator app two-factor authentication is not enabled for this account.');
}

export async function beginTotpReset(db: Db, userId: string) {
	await requireExistingTotp(db, userId);

	const code = generateTotpResetCode();
	const identifier = totpResetCodeIdentifier(userId);
	const value = await hashTotpResetCode(userId, code);

	await db.delete(verification).where(eq(verification.identifier, identifier));
	await db.insert(verification).values({
		id: ulid(),
		identifier,
		value,
		expiresAt: new Date(Date.now() + TOTP_RESET_CODE_TTL_MS)
	});

	return code;
}

export async function verifyTotpResetCode(db: Db, userId: string, code: string) {
	await requireExistingTotp(db, userId);

	const normalizedCode = normalizeTotpResetCode(code);
	if (normalizedCode.length !== TOTP_RESET_CODE_LENGTH)
		error(400, 'Enter the verification code from your email.');

	const identifier = totpResetCodeIdentifier(userId);
	const value = await hashTotpResetCode(userId, normalizedCode);
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

	const grantIdentifier = totpResetGrantIdentifier(userId);
	await db.delete(verification).where(eq(verification.identifier, grantIdentifier));
	await db.insert(verification).values({
		id: ulid(),
		identifier: grantIdentifier,
		value: 'verified',
		expiresAt: new Date(Date.now() + TOTP_RESET_GRANT_TTL_MS)
	});
}

export async function requireTotpResetGrant(db: Db, userId: string) {
	await requireExistingTotp(db, userId);

	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, totpResetGrantIdentifier(userId)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!record) error(400, 'Verify your email before changing two-factor authentication.');
}

export async function clearTotpResetGrant(db: Db, userId: string) {
	await db
		.delete(verification)
		.where(eq(verification.identifier, totpResetGrantIdentifier(userId)));
}
