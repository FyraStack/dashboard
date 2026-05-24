import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, gt } from 'drizzle-orm';
import PasswordChangeCodeEmail from '$lib/emails/password-change-code.svelte';
import { initAuth } from '$lib/server/auth';
import { initDrizzle } from '$lib/server/db';
import { verification } from '$lib/server/db/schema';
import { sendRenderedEmail } from '$lib/server/email';
import { ulid } from '$lib/server/id';
import { account } from '$lib/server/db/auth.schema';

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;

function passwordChangeIdentifier(userId: string) {
	return `password-change:${userId}`;
}

function passwordChangePasskeyIdentifier(userId: string) {
	return `password-change-passkey:${userId}`;
}

function generateCode() {
	const max = 10 ** CODE_LENGTH;
	const value = crypto.getRandomValues(new Uint32Array(1))[0] % max;
	return value.toString().padStart(CODE_LENGTH, '0');
}

async function hashCode(userId: string, code: string) {
	const data = new TextEncoder().encode(`${userId}:${code}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeCode(code: string) {
	return code.replace(/\D/g, '');
}

async function changePasswordOauth(newPassword: string) {
	const event = getRequestEvent();
	const auth = initAuth();

	await auth.api.setPassword({
		headers: event.request.headers,
		body: { newPassword }
	});
	await auth.api.revokeOtherSessions({
		headers: event.request.headers,
	});
}

async function changePassword(currentPassword: string, newPassword: string) {
	const event = getRequestEvent();
	const auth = initAuth();

	await auth.api.changePassword({
		headers: event.request.headers,
		body: { currentPassword, newPassword, revokeOtherSessions: true }
	});
}

export const sendPasswordChangeCode = command(async () => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	const db = initDrizzle();
	const code = generateCode();
	const identifier = passwordChangeIdentifier(user.id);
	const value = await hashCode(user.id, code);
	const expiresAt = new Date(Date.now() + CODE_TTL_MS);

	await db.delete(verification).where(eq(verification.identifier, identifier));
	await db.insert(verification).values({ id: ulid(), identifier, value, expiresAt });

	await sendRenderedEmail({
		component: PasswordChangeCodeEmail,
		props: { userName: user.name, code, expiresInMinutes: CODE_TTL_MS / 60_000 },
		subject: 'Confirm your Stack password change',
		to: user.email
	});
});

const emailParams = type({ currentPassword: 'string', newPassword: 'string', code: 'string' });

export const hasPassword = command(async () => {
	const db = initDrizzle();
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');
	const [credentialAccount] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
		.limit(1);

	return !!credentialAccount;
});

export const confirmPasswordChangeWithEmail = command(emailParams, async (params) => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	const code = normalizeCode(params.code);
	if (code.length !== CODE_LENGTH) error(400, 'Enter the verification code from your email.');

	const db = initDrizzle();
	const identifier = passwordChangeIdentifier(user.id);
	const value = await hashCode(user.id, code);
	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, identifier),
				eq(verification.value, value),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	if (!record) error(400, 'Invalid or expired verification code.');

	if (await hasPassword()) {
		await changePassword(params.currentPassword, params.newPassword);
	} else {
		await changePasswordOauth(params.newPassword);
	}
	await db.delete(verification).where(eq(verification.id, record.id));
});

const totpParams = type({ currentPassword: 'string', newPassword: 'string', code: 'string' });

export const confirmPasswordChangeWithTotp = command(totpParams, async (params) => {
	const event = getRequestEvent();
	if (!event.locals.user) error(401, 'Authentication required');

	const code = normalizeCode(params.code);
	if (code.length !== CODE_LENGTH)
		error(400, 'Enter the verification code from your authenticator app.');

	const auth = initAuth();
	await auth.api.verifyTOTP({
		headers: event.request.headers,
		body: { code, trustDevice: false }
	});

	if (await hasPassword()) {
		await changePassword(params.currentPassword, params.newPassword);
	} else {
		await changePasswordOauth(params.newPassword);
	}
});

const passkeyParams = type({ currentPassword: 'string', newPassword: 'string' });

export const confirmPasswordChangeWithPasskey = command(passkeyParams, async (params) => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	const db = initDrizzle();
	const identifier = passwordChangePasskeyIdentifier(user.id);
	const [record] = await db
		.select({ id: verification.id })
		.from(verification)
		.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, new Date())))
		.limit(1);

	if (!record) error(400, 'Verify with your passkey before changing your password.');

	if (await hasPassword()) {
		await changePassword(params.currentPassword, params.newPassword);
	} else {
		await changePasswordOauth(params.newPassword);
	}
	await db.delete(verification).where(eq(verification.id, record.id));
});
