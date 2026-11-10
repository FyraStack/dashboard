import { and, eq, gt, sql } from 'drizzle-orm';
import { verification } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { ulid } from '#lib/server/id.js';

const STEP_UP_MAX_ATTEMPTS = 5;
const STEP_UP_LOCKOUT_MS = 15 * 60 * 1000;

type VerificationRow = typeof verification.$inferSelect;

function stepUpAttemptsIdentifier(userId: string) {
	return `step-up-attempts:${userId}`;
}

async function reserveStepUpAttempt(db: Database, userId: string) {
	const identifier = stepUpAttemptsIdentifier(userId);
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
	await db
		.delete(verification)
		.where(eq(verification.identifier, stepUpAttemptsIdentifier(userId)));
	return result;
}

export async function consumeVerification(
	db: Database,
	identifier: string,
	value?: string
): Promise<VerificationRow | null> {
	const [consumed] = await db
		.delete(verification)
		.where(
			and(
				eq(verification.identifier, identifier),
				value === undefined ? undefined : eq(verification.value, value),
				gt(verification.expiresAt, new Date())
			)
		)
		.returning();
	return consumed ?? null;
}

export async function restoreVerification(db: Database, row: VerificationRow) {
	await db.insert(verification).values(row).onConflictDoNothing();
}
