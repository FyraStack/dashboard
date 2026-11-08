import { and, eq } from 'drizzle-orm';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
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
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const tokens = await db.query.apiTokens.findMany({
		where: eq(apiTokens.userId, locals.user.id)
	});

	return tokens.map((t) => ({
		id: t.id,
		name: t.name,
		createdAt: t.createdAt,
		lastUsedAt: null
	}));
}

function generateToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(token);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createApiToken(params: CreateApiTokenInput) {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const userId = locals.user.id;
	const plainToken = generateToken();
	const tokenHash = await hashToken(plainToken);
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
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const token = await db.query.apiTokens.findFirst({
		where: and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, locals.user.id))
	});

	if (!token) {
		error(404, 'API token not found');
	}

	await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, locals.user.id)));
	captureServerEvent('api_token_revoked', { token_id: params.tokenId });
}
