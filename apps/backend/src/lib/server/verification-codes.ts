import { and, eq, gt, sql } from 'drizzle-orm';
import { sha256Hex } from 'stack-shared/hash';
import { ulid } from 'ulid';
import { verification } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';

const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 60 * 1000;
const STEP_UP_MAX_ATTEMPTS = 5;
const STEP_UP_LOCKOUT_MS = 15 * 60 * 1000;

export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_PROOF_TTL_MS = 60 * 1000;

export const verificationIdentifiers = {
	passwordChangeCode: (userId: string) => `password-change:${userId}`,
	passwordChangePasskey: (userId: string) => `password-change-passkey:${userId}`,
	pendingEmailChange: (userId: string) => `pending-email-change:${userId}`,
	adminActionIntent: (adminUserId: string) => `admin-user-delete-intent:${adminUserId}`,
	adminActionPasskey: (adminUserId: string, targetId: string) =>
		`admin-user-delete-passkey:${adminUserId}:${targetId}`,
	adminActionEmail: (adminUserId: string, targetId: string) =>
		`admin-user-delete-email:${adminUserId}:${targetId}`,
	totpResetCode: (userId: string) => `totp-reset:${userId}`,
	totpResetGrant: (userId: string) => `totp-reset-verified:${userId}`,
	stepUpAttempts: (userId: string) => `step-up-attempts:${userId}`,
	billingSetup: (projectId: string, tokenHash: string) => `billing-setup:${projectId}:${tokenHash}`
};

export type VerificationRow = typeof verification.$inferSelect;

interface CodeRecord {
	attempts: number;
	hash: string;
}

export function parseVerificationCode(input: string, length = CODE_LENGTH): string | null {
	const digits = input.replace(/\D/g, '');
	return digits.length === length ? digits : null;
}

function generateCode(): string {
	const max = 10 ** CODE_LENGTH;
	const range = 2 ** 32;
	const limit = range - (range % max);
	const values = new Uint32Array(1);

	do {
		crypto.getRandomValues(values);
	} while (values[0] >= limit);

	return (values[0] % max).toString().padStart(CODE_LENGTH, '0');
}

function hashCode(identifier: string, code: string): Promise<string> {
	return sha256Hex(`${identifier}:${code}`);
}

function parseCodeRecord(value: string): CodeRecord | null {
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

export async function findVerification(db: Database, identifier: string) {
	const [record] = await db
		.select({
			id: verification.id,
			value: verification.value,
			createdAt: verification.createdAt
		})
		.from(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.limit(1);
	return record;
}

export async function clearVerification(db: Database, identifier: string, value?: string) {
	await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, identifier),
				value === undefined ? undefined : eq(verification.value, value)
			)
		);
}

export async function storeVerification(
	db: Database,
	{ identifier, value, ttlMs }: { identifier: string; value: string; ttlMs: number }
) {
	await clearVerification(db, identifier);
	await db.insert(verification).values({
		id: ulid(),
		identifier,
		value,
		expiresAt: new Date(Date.now() + ttlMs)
	});
}

export async function issueVerificationCode(
	db: Database,
	identifier: string
): Promise<string | null> {
	const existing = await findVerification(db, identifier);
	if (existing && Date.now() - existing.createdAt.getTime() < RESEND_INTERVAL_MS) {
		return null;
	}

	const code = generateCode();
	const record: CodeRecord = { hash: await hashCode(identifier, code), attempts: 0 };
	await storeVerification(db, {
		identifier,
		value: JSON.stringify(record),
		ttlMs: VERIFICATION_CODE_TTL_MS
	});
	return code;
}

export async function issueFreshVerificationCode(db: Database, identifier: string) {
	const code = await issueVerificationCode(db, identifier);
	if (!code) {
		error(429, 'A code was sent recently. Check your email or wait a minute to request another.');
	}
	return code;
}

export async function consumeVerification(
	db: Database,
	identifier: string
): Promise<VerificationRow | null> {
	const [consumed] = await db
		.delete(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.returning();
	return consumed ?? null;
}

export async function restoreVerification(db: Database, row: VerificationRow) {
	await db.insert(verification).values(row).onConflictDoNothing();
}

type CodeCheck = { status: 'consumed'; row: VerificationRow } | { status: 'invalid' | 'exhausted' };

export async function consumeVerificationCode(
	db: Database,
	identifier: string,
	input: string
): Promise<VerificationRow> {
	const code = parseVerificationCode(input);
	if (!code) {
		error(400, 'Enter the verification code from your email.');
	}

	const submittedHash = await hashCode(identifier, code);
	const check = await db.transaction(async (tx): Promise<CodeCheck> => {
		const [row] = await tx
			.select()
			.from(verification)
			.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
			.limit(1)
			.for('update');
		const record = row ? parseCodeRecord(row.value) : null;
		if (!(row && record)) {
			return { status: 'invalid' };
		}

		if (record.attempts < MAX_ATTEMPTS && submittedHash === record.hash) {
			await tx.delete(verification).where(eq(verification.id, row.id));
			return { status: 'consumed', row };
		}

		const attempts = record.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			await tx.delete(verification).where(eq(verification.id, row.id));
			return { status: 'exhausted' };
		}

		await tx
			.update(verification)
			.set({ value: JSON.stringify({ hash: record.hash, attempts } satisfies CodeRecord) })
			.where(eq(verification.id, row.id));
		return { status: 'invalid' };
	});

	if (check.status !== 'consumed') {
		error(
			400,
			check.status === 'exhausted'
				? 'Too many incorrect attempts. Request a new verification code.'
				: 'Invalid or expired verification code.'
		);
	}
	return check.row;
}

export async function consumeProof(db: Database, identifier: string, missingMessage: string) {
	const proof = await consumeVerification(db, identifier);
	if (!proof) {
		error(400, missingMessage);
	}
	return proof;
}

async function reserveStepUpAttempt(db: Database, userId: string) {
	const identifier = verificationIdentifiers.stepUpAttempts(userId);
	const now = new Date();

	const allowed = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
		const [row] = await tx
			.select({ id: verification.id, value: verification.value })
			.from(verification)
			.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
			.limit(1);

		const attempts = row ? Number(row.value) : 0;
		if (attempts >= STEP_UP_MAX_ATTEMPTS) {
			return false;
		}

		if (row) {
			await tx
				.update(verification)
				.set({ value: String(attempts + 1) })
				.where(eq(verification.id, row.id));
			return true;
		}

		await tx.delete(verification).where(eq(verification.identifier, identifier));
		await tx.insert(verification).values({
			id: ulid(),
			identifier,
			value: '1',
			expiresAt: new Date(now.getTime() + STEP_UP_LOCKOUT_MS)
		});
		return true;
	});

	if (!allowed) {
		error(429, 'Too many verification attempts. Wait 15 minutes and try again.');
	}
}

export async function withStepUpAttemptLimit<T>(
	db: Database,
	userId: string,
	verify: () => Promise<T>
): Promise<T> {
	await reserveStepUpAttempt(db, userId);
	const result = await verify();
	await clearVerification(db, verificationIdentifiers.stepUpAttempts(userId));
	return result;
}

export async function recordPasskeyProofs(db: Database, userId: string, credentialId: string) {
	const adminIntent = await consumeVerification(
		db,
		verificationIdentifiers.adminActionIntent(userId)
	);
	if (adminIntent) {
		await storeVerification(db, {
			identifier: verificationIdentifiers.adminActionPasskey(userId, adminIntent.value),
			value: credentialId,
			ttlMs: VERIFICATION_PROOF_TTL_MS
		});
	}

	await storeVerification(db, {
		identifier: verificationIdentifiers.passwordChangePasskey(userId),
		value: credentialId,
		ttlMs: VERIFICATION_PROOF_TTL_MS
	});
}
