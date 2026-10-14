import { error } from '@sveltejs/kit';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { type RequestDetails, requestFingerprint } from '#lib/idempotency.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { idempotencyKeys } from '#lib/server/db/schema.js';

const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
const ABANDONED_PENDING_MS = 60 * 60 * 1000;
type JsonResult = string | number | boolean | null | { [key: string]: JsonResult | undefined };

export async function withIdempotency<T extends JsonResult>(
	db: Pick<Database, 'insert' | 'select' | 'update' | 'delete'>,
	options: { key: string; operation: string; args: RequestDetails },
	fn: () => Promise<T>
): Promise<T> {
	const { key, operation, args } = options;
	const fingerprint = await requestFingerprint(operation, args);
	const [claimed] = await db
		.insert(idempotencyKeys)
		.values({ key, fingerprint, expiresAt: Date.now() + COMPLETED_TTL_MS })
		.onConflictDoNothing({ target: idempotencyKeys.key })
		.returning({ key: idempotencyKeys.key });

	if (!claimed) {
		const [existing] = await db
			.select()
			.from(idempotencyKeys)
			.where(eq(idempotencyKeys.key, key))
			.limit(1);
		if (existing && existing.fingerprint !== fingerprint) {
			error(422, 'This request was already submitted with different details.');
		}
		if (existing?.status === 'completed' && existing.result !== null) {
			return JSON.parse(existing.result) as T;
		}
		error(
			409,
			'This request has already started. Check its status before submitting another. If it remains unresolved, contact support.'
		);
	}

	let result: T;
	try {
		result = await fn();
	} catch (err) {
		await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
		throw err;
	}
	const now = Date.now();
	await db
		.update(idempotencyKeys)
		.set({
			status: 'completed',
			result: JSON.stringify(result),
			updatedAt: now,
			expiresAt: now + COMPLETED_TTL_MS
		})
		.where(eq(idempotencyKeys.key, key));
	return result;
}

export async function purgeExpiredIdempotencyKeys(now = Date.now(), limit = 500) {
	const db = initDrizzle();
	const expired = or(
		and(eq(idempotencyKeys.status, 'completed'), lt(idempotencyKeys.expiresAt, now)),
		and(
			eq(idempotencyKeys.status, 'pending'),
			lt(idempotencyKeys.createdAt, now - ABANDONED_PENDING_MS)
		)
	);
	const batch = db
		.select({ key: idempotencyKeys.key })
		.from(idempotencyKeys)
		.where(expired)
		.limit(limit);
	const deleted = await db
		.delete(idempotencyKeys)
		.where(and(expired, inArray(idempotencyKeys.key, batch)))
		.returning({ key: idempotencyKeys.key });
	return { purged: deleted.length };
}
