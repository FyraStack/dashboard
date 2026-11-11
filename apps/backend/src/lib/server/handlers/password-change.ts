import { and, eq } from 'drizzle-orm';
import type { VerificationMethod } from 'stack-shared/auth';
import PasswordChangeCodeEmail from '#lib/emails/password-change-code.svelte';
import { initAuth } from '#lib/server/auth.js';
import { requireUser } from '#lib/server/auth-context.js';
import { type AppUser, context } from '#lib/server/context.js';
import { account } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { verifyTotpCode } from '#lib/server/totp-verification.js';
import {
	consumeProof,
	consumeVerificationCode,
	issueFreshVerificationCode,
	restoreVerification,
	VERIFICATION_CODE_TTL_MS,
	verificationIdentifiers,
	withStepUpAttemptLimit
} from '#lib/server/verification-codes.js';

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

interface Passwords {
	currentPassword: string;
	newPassword: string;
}

interface Proof {
	cookies: string[];
	restore?: () => Promise<void>;
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

async function hasCredentialPassword(db: Database, userId: string) {
	const [credentialAccount] = await db
		.select({ id: account.id })
		.from(account)
		.where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
		.limit(1);

	return !!credentialAccount;
}

async function changeOwnPassword(db: Database, userId: string, passwords: Passwords) {
	return (await hasCredentialPassword(db, userId))
		? await changePassword(passwords.currentPassword, passwords.newPassword)
		: await changePasswordOauth(passwords.newPassword);
}

async function confirmPasswordChange(
	method: VerificationMethod,
	passwords: Passwords,
	prove: (user: AppUser, db: Database) => Promise<Proof>
) {
	const { db, user } = requireUser();

	const proof = await prove(user, db);
	let passwordCookies: string[];
	try {
		passwordCookies = await changeOwnPassword(db, user.id, passwords);
	} catch (err) {
		await proof.restore?.();
		throw err;
	}
	captureServerEvent('password_changed', { verification_method: method });

	return { setCookie: [...proof.cookies, ...passwordCookies] };
}

export async function sendPasswordChangeCode() {
	const { db, user } = requireUser();

	const code = await issueFreshVerificationCode(
		db,
		verificationIdentifiers.passwordChangeCode(user.id)
	);

	await sendRenderedEmail({
		component: PasswordChangeCodeEmail,
		props: { userName: user.name, code, expiresInMinutes: VERIFICATION_CODE_TTL_MS / 60_000 },
		subject: 'Confirm your Stack password change',
		to: user.email
	});
}

export function hasPassword() {
	const { db, user } = requireUser();
	return hasCredentialPassword(db, user.id);
}

export function confirmPasswordChangeWithEmail(params: ConfirmPasswordChangeWithEmailInput) {
	return confirmPasswordChange('email', params, async (user, db) => {
		const code = await withStepUpAttemptLimit(db, user.id, () =>
			consumeVerificationCode(db, verificationIdentifiers.passwordChangeCode(user.id), params.code)
		);
		return { cookies: [], restore: () => restoreVerification(db, code) };
	});
}

export function confirmPasswordChangeWithTotp(params: ConfirmPasswordChangeWithTotpInput) {
	return confirmPasswordChange('totp', params, async (user, db) => {
		const verified = await verifyTotpCode(db, user.id, params.code);
		return { cookies: verified.headers.getSetCookie() };
	});
}

export function confirmPasswordChangeWithPasskey(params: ConfirmPasswordChangeWithPasskeyInput) {
	return confirmPasswordChange('passkey', params, async (user, db) => {
		const proof = await consumeProof(
			db,
			verificationIdentifiers.passwordChangePasskey(user.id),
			'Verify with your passkey before changing your password.'
		);
		return { cookies: [], restore: () => restoreVerification(db, proof) };
	});
}
