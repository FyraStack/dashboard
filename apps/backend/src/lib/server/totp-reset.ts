import { and, eq, gt, inArray } from 'drizzle-orm';
import { type TotpResetChoice, totpResetChoices } from 'stack-shared/auth';
import type { Context } from '#lib/server/context.js';
import { account, twoFactor, user, verification } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import {
	clearVerification,
	consumeVerificationCode,
	findVerification,
	issueFreshVerificationCode,
	storeVerification,
	VERIFICATION_CODE_TTL_MS,
	verificationIdentifiers
} from '#lib/server/verification-codes.js';

const TOTP_SECRET_ENVELOPE_PREFIX = '$ba$';

const pendingTwoFactorCookieNames = ['__Secure-better-auth.two_factor', 'better-auth.two_factor'];

export interface TotpResetUser {
	email: string;
	id: string;
	name: string;
}

type VerifyPassword = (hash: string, password: string) => Promise<boolean>;

const legacyTotpResetChoices = new Map<string, TotpResetChoice>([
	['reset-totp', 'reset'],
	['disable-totp', 'disable']
]);

export function normalizeTotpResetChoice(value: string): TotpResetChoice | null {
	const canonical = legacyTotpResetChoices.get(value) ?? value;
	return totpResetChoices.find((choice) => choice === canonical) ?? null;
}

async function verifySignedCookieValue(raw: string, secret: string) {
	const separator = raw.lastIndexOf('.');
	if (separator < 1) {
		return null;
	}
	const value = raw.slice(0, separator);
	const signature = raw.slice(separator + 1);
	if (signature.length !== 44 || !signature.endsWith('=')) {
		return null;
	}

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
	event: Context,
	db: Database,
	secret: string
): Promise<TotpResetUser | null> {
	const verified = await Promise.all(
		pendingTwoFactorCookieNames.map((name) => {
			const raw = event.cookies.get(name);
			return raw ? verifySignedCookieValue(raw, secret) : null;
		})
	);
	const identifiers = verified.filter((identifier): identifier is string => identifier !== null);
	if (identifiers.length === 0) {
		return null;
	}

	const pendingUsers = await db
		.select({
			identifier: verification.identifier,
			id: user.id,
			email: user.email,
			name: user.name
		})
		.from(verification)
		.innerJoin(user, eq(user.id, verification.value))
		.where(
			and(inArray(verification.identifier, identifiers), gt(verification.expiresAt, new Date()))
		);

	for (const identifier of identifiers) {
		const pending = pendingUsers.find((row) => row.identifier === identifier);
		if (pending) {
			return { id: pending.id, email: pending.email, name: pending.name };
		}
	}

	return null;
}

export async function requiresTotpReset(db: Database, userId: string) {
	const [registeredTotp] = await db
		.select({ secret: twoFactor.secret })
		.from(twoFactor)
		.where(eq(twoFactor.userId, userId))
		.limit(1);

	return !!registeredTotp && !registeredTotp.secret.startsWith(TOTP_SECRET_ENVELOPE_PREFIX);
}

export async function removeTotpWithVerifiedPassword(
	db: Database,
	userId: string,
	password: string,
	verifyPassword: VerifyPassword
) {
	const [credential] = await db
		.select({ password: account.password })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
		.limit(1);

	if (!(credential?.password && (await verifyPassword(credential.password, password)))) {
		error(400, 'Incorrect password.');
	}

	await db.delete(twoFactor).where(eq(twoFactor.userId, userId));
	await db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
}

async function requireLegacyTotp(db: Database, userId: string) {
	if (!(await requiresTotpReset(db, userId))) {
		error(403, 'Two-factor authentication cannot be reset for this account.');
	}
}

export async function beginTotpReset(db: Database, userId: string) {
	await requireLegacyTotp(db, userId);
	return await issueFreshVerificationCode(db, verificationIdentifiers.totpResetCode(userId));
}

export async function verifyTotpResetCode(db: Database, userId: string, code: string) {
	await requireLegacyTotp(db, userId);
	await consumeVerificationCode(db, verificationIdentifiers.totpResetCode(userId), code);
	await storeVerification(db, {
		identifier: verificationIdentifiers.totpResetGrant(userId),
		value: 'verified',
		ttlMs: VERIFICATION_CODE_TTL_MS
	});
}

export async function requireTotpResetGrant(db: Database, userId: string) {
	await requireLegacyTotp(db, userId);

	const grant = await findVerification(db, verificationIdentifiers.totpResetGrant(userId));
	if (!grant) {
		error(400, 'Verify your email before changing two-factor authentication.');
	}
}

export async function clearTotpResetGrant(db: Database, userId: string) {
	await clearVerification(db, verificationIdentifiers.totpResetGrant(userId));
}
