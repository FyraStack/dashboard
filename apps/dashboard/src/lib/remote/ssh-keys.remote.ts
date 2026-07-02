import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq, and } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { sshKeys } from '$lib/server/db/schema';

type ListResult = {
	id: string;
	name: string;
	fingerprint: string;
	publicKey: string;
	description: string | null;
}[];

export const listSshKeys = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	return db.query.sshKeys.findMany({
		where: eq(sshKeys.userId, event.locals.user.id)
	});
});

const createParams = type({
	name: 'string',
	publicKey: 'string',
	description: 'string?'
});
type CreateResult = { id: string; fingerprint: string };

export const createSshKey = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	const parts = params.publicKey.trim().split(/\s+/);
	if (parts.length < 2) error(400, 'Invalid SSH public key format');

	const keyData = parts[1];
	let raw: Uint8Array;
	try {
		raw = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
	} catch {
		error(400, 'Invalid SSH public key: key data is not valid base64');
	}

	let fingerprint: string;
	try {
		const hash = await crypto.subtle.digest('SHA-256', raw as BufferSource);
		fingerprint = 'SHA256:' + btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=+$/, '');
	} catch {
		error(400, 'Invalid SSH public key: could not compute fingerprint');
	}

	const [inserted] = await db
		.insert(sshKeys)
		.values({
			userId: event.locals.user.id,
			name: params.name,
			publicKey: params.publicKey.trim(),
			fingerprint,
			description: params.description ?? null
		})
		.returning();

	return { id: inserted.id, fingerprint: inserted.fingerprint };
});

const deleteParams = type({ keyId: 'string' });
export const deleteSshKey = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	const key = await db.query.sshKeys.findFirst({
		where: and(eq(sshKeys.id, params.keyId), eq(sshKeys.userId, event.locals.user.id))
	});

	if (!key) error(404, 'SSH key not found');

	await db
		.delete(sshKeys)
		.where(and(eq(sshKeys.id, params.keyId), eq(sshKeys.userId, event.locals.user.id)));
});
