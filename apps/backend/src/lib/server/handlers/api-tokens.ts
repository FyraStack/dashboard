import { and, eq } from 'drizzle-orm';
import { sha256Hex, toHex } from 'stack-shared/hash';
import { requireUser } from '#lib/server/auth-context.js';
import { apiTokens } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';

export interface CreateApiTokenInput {
	idempotencyKey: string;
	name: string;
}
export interface RevokeApiTokenInput {
	tokenId: string;
}

export async function listApiTokens() {
	const { db, user } = requireUser();
	const tokens = await db.query.apiTokens.findMany({
		where: eq(apiTokens.userId, user.id)
	});

	return tokens.map((t) => ({
		id: t.id,
		name: t.name,
		createdAt: t.createdAt,
		lastUsedAt: null
	}));
}

function generateToken(): string {
	return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createApiToken(params: CreateApiTokenInput) {
	const { db, user } = requireUser();
	const userId = user.id;
	const plainToken = generateToken();
	const tokenHash = await sha256Hex(plainToken);
	let insertedNow = false;

	const { id } = await withIdempotency(
		db,
		{
			key: params.idempotencyKey,
			operation: 'apiTokens.createApiToken',
			args: { name: params.name, userId }
		},
		async () => {
			const [inserted] = await db
				.insert(apiTokens)
				.values({ userId, name: params.name, tokenHash, createdAt: Date.now() })
				.returning();
			insertedNow = true;
			captureServerEvent('api_token_created', { token_id: inserted.id });
			return { id: inserted.id };
		}
	);

	if (!insertedNow) {
		const [rotated] = await db
			.update(apiTokens)
			.set({ tokenHash })
			.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
			.returning({ id: apiTokens.id });
		if (!rotated) {
			error(409, 'This token was revoked. Create a new one.');
		}
	}

	return { id, token: plainToken };
}

export async function revokeApiToken(params: RevokeApiTokenInput) {
	const { db, user } = requireUser();
	const token = await db.query.apiTokens.findFirst({
		where: and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, user.id))
	});

	if (!token) {
		error(404, 'API token not found');
	}

	await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, user.id)));
	captureServerEvent('api_token_revoked', { token_id: params.tokenId });
}
