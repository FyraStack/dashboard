import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq, and } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { apiTokens } from '$lib/server/db/schema';

type ListResult = {
	id: string;
	name: string;
	createdAt: number;
	lastUsedAt: number | null;
}[];

export const listApiTokens = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const tokens = await db.query.apiTokens.findMany({
		where: eq(apiTokens.userId, event.locals.user.id)
	});

	return tokens.map((t) => ({
		id: t.id,
		name: t.name,
		createdAt: t.createdAt,
		lastUsedAt: null
	}));
});

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

const createParams = type({ name: 'string' });
type CreateResult = { id: string; token: string };

export const createApiToken = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const plainToken = generateToken();
	const tokenHash = await hashToken(plainToken);

	const [inserted] = await db
		.insert(apiTokens)
		.values({
			userId: event.locals.user.id,
			name: params.name,
			tokenHash,
			createdAt: Date.now()
		})
		.returning();

	return { id: inserted.id, token: plainToken };
});

const revokeParams = type({ tokenId: 'string' });

export const revokeApiToken = command(revokeParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const token = await db.query.apiTokens.findFirst({
		where: and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, event.locals.user.id))
	});

	if (!token) error(404, 'API token not found');

	await db
		.delete(apiTokens)
		.where(and(eq(apiTokens.id, params.tokenId), eq(apiTokens.userId, event.locals.user.id)));
});
