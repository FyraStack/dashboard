import { error, type RequestEvent } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { account, twoFactor, user, verification } from './db/auth.schema';
import type { initDrizzle } from './db';
import { ulid } from './id';

export const TOTP_RESET_CODE_LENGTH = 6;
export const TOTP_RESET_CODE_TTL_MS = 10 * 60 * 1000;
export const TOTP_RESET_GRANT_TTL_MS = 10 * 60 * 1000;
export const TOTP_RESET_MAX_ATTEMPTS = 5;
export const TOTP_RESET_RESEND_INTERVAL_MS = 60 * 1000;
export const TOTP_SECRET_ENVELOPE_PREFIX = '$ba$';

const pendingTwoFactorCookieNames = ['__Secure-better-auth.two_factor', 'better-auth.two_factor'];

export type TotpResetChoice = 'reset' | 'disable';

export type TotpResetCodeRecord = { hash: string; attempts: number };

export type TotpResetUser = { id: string; email: string; name: string };

type VerifyPassword = (hash: string, password: string) => Promise<boolean>;

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

export function encodeTotpResetCodeRecord(record: TotpResetCodeRecord) {
	return JSON.stringify(record);
}

export function parseTotpResetCodeRecord(value: string): TotpResetCodeRecord | null {
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'hash' in parsed &&
			typeof parsed.hash === 'string' &&
			'attempts' in parsed &&
			typeof parsed.attempts === 'number' &&
			Number.isInteger(parsed.attempts) &&
			parsed.attempts >= 0
		) {
			return { hash: parsed.hash, attempts: parsed.attempts };
		}
	} catch {
		return null;
	}
	return null;
}

export function canResendTotpResetCode(lastSentAt: Date | null, now = new Date()) {
	if (!lastSentAt) return true;
	return now.getTime() - lastSentAt.getTime() >= TOTP_RESET_RESEND_INTERVAL_MS;
}

export function totpResetAttemptsExhausted(record: TotpResetCodeRecord) {
	return record.attempts >= TOTP_RESET_MAX_ATTEMPTS;
}

export function isLegacyTotpSecret(encryptedSecret: string) {
	return !encryptedSecret.startsWith(TOTP_SECRET_ENVELOPE_PREFIX);
}

async function verifySignedCookieValue(raw: string, secret: string) {
	const separator = raw.lastIndexOf('.');
	if (separator < 1) return null;
	const value = raw.slice(0, separator);
	const signature = raw.slice(separator + 1);
	if (signature.length !== 44 || !signature.endsWith('=')) return null;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
	const signatureBytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
	const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(value));
	return valid ? value : null;
}

export async function resolvePendingTwoFactorUser(
	event: RequestEvent,
	db: Db,
	secret: string
): Promise<TotpResetUser | null> {
	for (const cookieName of pendingTwoFactorCookieNames) {
		const raw = event.cookies.get(cookieName);
		if (!raw) continue;

		const identifier = await verifySignedCookieValue(raw, secret);
		if (!identifier) continue;

		const [pending] = await db
			.select({ userId: verification.value })
			.from(verification)
			.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
			.limit(1);
		if (!pending) continue;

		const [pendingUser] = await db
			.select({ id: user.id, email: user.email, name: user.name })
			.from(user)
			.where(eq(user.id, pending.userId))
			.limit(1);
		if (pendingUser) return pendingUser;
	}

	return null;
}

export async function requiresTotpReset(db: Db, userId: string) {
	const [registeredTotp] = await db
		.select({ secret: twoFactor.secret })
		.from(twoFactor)
		.where(eq(twoFactor.userId, userId))
		.limit(1);

	return !!registeredTotp && isLegacyTotpSecret(registeredTotp.secret);
}

export async function removeTotpWithVerifiedPassword(
	db: Db,
	userId: string,
	password: string,
	verifyPassword: VerifyPassword
) {
	const [credential] = await db
		.select({ password: account.password })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
		.limit(1);

	if (!credential?.password || !(await verifyPassword(credential.password, password)))
		error(400, 'Incorrect password.');

	await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
	await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
}

export async function requireLegacyTotp(db: Db, userId: string) {
	if (!(await requiresTotpReset(db, userId)))
		error(403, 'Two-factor authentication cannot be reset for this account.');
}

export async function beginTotpReset(db: Db, userId: string) {
	await requireLegacyTotp(db, userId);

	const identifier = totpResetCodeIdentifier(userId);
	const [existing] = await db
		.select({ createdAt: verification.createdAt })
		.from(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.limit(1);

	if (existing && !canResendTotpResetCode(existing.createdAt))
		error(429, 'A code was sent recently. Check your email or wait a minute to request another.');

	const code = generateTotpResetCode();
	const value = encodeTotpResetCodeRecord({
		hash: await hashTotpResetCode(userId, code),
		attempts: 0
	});

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
	await requireLegacyTotp(db, userId);

	const normalizedCode = normalizeTotpResetCode(code);
	if (normalizedCode.length !== TOTP_RESET_CODE_LENGTH)
		error(400, 'Enter the verification code from your email.');

	const identifier = totpResetCodeIdentifier(userId);
	const [row] = await db
		.select({ id: verification.id, value: verification.value })
		.from(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.limit(1);

	const record = row ? parseTotpResetCodeRecord(row.value) : null;
	if (!row || !record) error(400, 'Invalid or expired verification code.');

	if (totpResetAttemptsExhausted(record)) {
		await db.delete(verification).where(eq(verification.id, row.id));
		error(400, 'Too many incorrect attempts. Request a new verification code.');
	}

	const submittedHash = await hashTotpResetCode(userId, normalizedCode);
	if (submittedHash !== record.hash) {
		const failed = { hash: record.hash, attempts: record.attempts + 1 };
		if (totpResetAttemptsExhausted(failed)) {
			await db.delete(verification).where(eq(verification.id, row.id));
			error(400, 'Too many incorrect attempts. Request a new verification code.');
		}
		await db
			.update(verification)
			.set({ value: encodeTotpResetCodeRecord(failed) })
			.where(eq(verification.id, row.id));
		error(400, 'Invalid or expired verification code.');
	}

	await db.delete(verification).where(eq(verification.id, row.id));

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
	await requireLegacyTotp(db, userId);

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
