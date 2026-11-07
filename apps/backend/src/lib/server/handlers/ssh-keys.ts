import { and, eq } from 'drizzle-orm';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { sshKeys } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';
import { captureServerEvent } from '#lib/server/posthog.js';

const WHITESPACE_PATTERN = /\s+/;
const TRAILING_PADDING_PATTERN = /[=]+$/;

export interface CreateSshKeyInput {
	description?: string;
	idempotencyKey: string;
	name: string;
	publicKey: string;
}
export interface DeleteSshKeyInput {
	keyId: string;
}

export function listSshKeys() {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();

	return db.query.sshKeys.findMany({
		where: eq(sshKeys.userId, locals.user.id)
	});
}

export async function createSshKey(params: CreateSshKeyInput) {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();

	const parts = params.publicKey.trim().split(WHITESPACE_PATTERN);
	if (parts.length < 2) {
		error(400, 'Invalid SSH public key format');
	}

	const [, keyData] = parts;
	let raw: Uint8Array;
	try {
		raw = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
	} catch {
		error(400, 'Invalid SSH public key: key data is not valid base64');
	}

	let fingerprint: string;
	try {
		const hash = await crypto.subtle.digest('SHA-256', raw as BufferSource);
		fingerprint = `SHA256:${btoa(String.fromCharCode(...new Uint8Array(hash))).replace(TRAILING_PADDING_PATTERN, '')}`;
	} catch {
		error(400, 'Invalid SSH public key: could not compute fingerprint');
	}

	const userId = locals.user.id;
	const { idempotencyKey, ...operationArgs } = params;
	return withIdempotency(
		db,
		{ key: idempotencyKey, operation: 'sshKeys.createSshKey', args: { ...operationArgs, userId } },
		async () => {
			const [inserted] = await db
				.insert(sshKeys)
				.values({
					userId,
					name: params.name,
					publicKey: params.publicKey.trim(),
					fingerprint,
					description: params.description ?? null
				})
				.returning();

			captureServerEvent('ssh_key_created', { key_type: parts[0] });

			return { id: inserted.id, fingerprint: inserted.fingerprint };
		}
	);
}

export async function deleteSshKey(params: DeleteSshKeyInput) {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();

	const key = await db.query.sshKeys.findFirst({
		where: and(eq(sshKeys.id, params.keyId), eq(sshKeys.userId, locals.user.id))
	});

	if (!key) {
		error(404, 'SSH key not found');
	}

	await db
		.delete(sshKeys)
		.where(and(eq(sshKeys.id, params.keyId), eq(sshKeys.userId, locals.user.id)));
	captureServerEvent('ssh_key_deleted');
}
