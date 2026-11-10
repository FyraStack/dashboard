import { and, eq } from 'drizzle-orm';
import PasswordChangeCodeEmail from '#lib/emails/password-change-code.svelte';
import { initAuth } from '#lib/server/auth.js';
import { context } from '#lib/server/context.js';
import { account, verification } from '#lib/server/db/auth.schema.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { error } from '#lib/server/http.js';
import { ulid } from '#lib/server/id.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import {
	consumeVerification,
	restoreVerification,
	withStepUpAttemptLimit
} from '#lib/server/step-up.js';

type VerificationRow = typeof verification.$inferSelect;

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;

export interface ConfirmPasswordChangeWithEmailInput {
	code: string;
	currentPassword: string;
	newPassword: string;
}
export interface ConfirmPasswordChangeWithTotpInput {
	code: string;
	currentPassword: string;
	newPassword: string;
}
export interface ConfirmPasswordChangeWithPasskeyInput {
	currentPassword: string;
	newPassword: string;
}

function passwordChangeIdentifier(userId: string) {
	return `password-change:${userId}`;
}

function passwordChangePasskeyIdentifier(userId: string) {
	return `password-change-passkey:${userId}`;
}

function generateCode() {
	const max = 10 ** CODE_LENGTH;
	const range = 2 ** 32;
	const limit = range - (range % max);
	const values = new Uint32Array(1);

	do {
		crypto.getRandomValues(values);
	} while (values[0] >= limit);

	return (values[0] % max).toString().padStart(CODE_LENGTH, '0');
}

async function hashCode(userId: string, code: string) {
	const data = new TextEncoder().encode(`${userId}:${code}`);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeCode(code: string) {
	return code.replace(/\D/g, '');
}

async function changePasswordOauth(newPassword: string): Promise<string[]> {
	const { request } = context();
	const auth = initAuth();

	const passwordSet = await auth.api.setPassword({
		headers: request.headers,
		body: { newPassword },
		returnHeaders: true
	});
	const sessionsRevoked = await auth.api.revokeOtherSessions({
		headers: request.headers,
		returnHeaders: true
	});

	return [...passwordSet.headers.getSetCookie(), ...sessionsRevoked.headers.getSetCookie()];
}

async function changePassword(currentPassword: string, newPassword: string): Promise<string[]> {
	const { request } = context();
	const auth = initAuth();

	const changed = await auth.api.changePassword({
		headers: request.headers,
		body: { currentPassword, newPassword, revokeOtherSessions: true },
		returnHeaders: true
	});

	return changed.headers.getSetCookie();
}

async function changePasswordOrRestoreProof(
	db: Database,
	proof: VerificationRow,
	params: { currentPassword: string; newPassword: string }
) {
	try {
		return (await hasPassword())
			? await changePassword(params.currentPassword, params.newPassword)
			: await changePasswordOauth(params.newPassword);
	} catch (err) {
		await restoreVerification(db, proof);
		throw err;
	}
}

export async function sendPasswordChangeCode() {
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}

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
}

export async function hasPassword() {
	const db = initDrizzle();
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}
	const [credentialAccount] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
		.limit(1);

	return !!credentialAccount;
}

export async function confirmPasswordChangeWithEmail(params: ConfirmPasswordChangeWithEmailInput) {
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}

	const code = normalizeCode(params.code);
	if (code.length !== CODE_LENGTH) {
		error(400, 'Enter the verification code from your email.');
	}

	const db = initDrizzle();
	const value = await hashCode(user.id, code);
	const proof = await withStepUpAttemptLimit(db, user.id, async () => {
		const consumed = await consumeVerification(db, passwordChangeIdentifier(user.id), value);
		if (!consumed) {
			error(400, 'Invalid or expired verification code.');
		}
		return consumed;
	});

	const setCookie = await changePasswordOrRestoreProof(db, proof, params);
	captureServerEvent('password_changed', { verification_method: 'email' });

	return { setCookie };
}

export async function confirmPasswordChangeWithTotp(params: ConfirmPasswordChangeWithTotpInput) {
	const { locals, request } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const code = normalizeCode(params.code);
	if (code.length !== CODE_LENGTH) {
		error(400, 'Enter the verification code from your authenticator app.');
	}

	const auth = initAuth();
	const verified = await withStepUpAttemptLimit(initDrizzle(), locals.user.id, () =>
		auth.api.verifyTOTP({
			headers: request.headers,
			body: { code, trustDevice: false },
			returnHeaders: true
		})
	);

	const passwordCookies = (await hasPassword())
		? await changePassword(params.currentPassword, params.newPassword)
		: await changePasswordOauth(params.newPassword);
	captureServerEvent('password_changed', { verification_method: 'totp' });

	return { setCookie: [...verified.headers.getSetCookie(), ...passwordCookies] };
}

export async function confirmPasswordChangeWithPasskey(
	params: ConfirmPasswordChangeWithPasskeyInput
) {
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const proof = await consumeVerification(db, passwordChangePasskeyIdentifier(user.id));
	if (!proof) {
		error(400, 'Verify with your passkey before changing your password.');
	}

	const setCookie = await changePasswordOrRestoreProof(db, proof, params);
	captureServerEvent('password_changed', { verification_method: 'passkey' });

	return { setCookie };
}
