import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import TotpResetCodeEmail from '$lib/emails/totp-reset-code.svelte';
import { initAuth, VERIFIED_2FA_DISABLE_HEADER } from '$lib/server/auth';
import { initDrizzle } from '$lib/server/db';
import { sendRenderedEmail } from '$lib/server/email';
import { sendSecurityAlertEmail } from '$lib/server/email-notifications';
import { getRuntimeEnv } from '$lib/server/env';
import {
	TOTP_RESET_CODE_TTL_MS,
	beginTotpReset,
	clearTotpResetGrant,
	normalizeTotpResetChoice,
	requireTotpResetGrant,
	verifyTotpResetCode as verifyTotpResetEmailCode
} from '$lib/server/totp-reset';

const CODE_LENGTH = 6;

const disableTwoFactorParams = type({ password: 'string', method: 'string', code: 'string' });

export const disableTwoFactorWithVerification = command(disableTwoFactorParams, async (params) => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	if (!params.password) error(400, 'Enter your current password.');

	const auth = initAuth();
	if (params.method === 'totp') {
		const code = params.code.replace(/\D/g, '');
		if (code.length !== CODE_LENGTH)
			error(400, 'Enter the verification code from your authenticator app.');

		await auth.api.verifyTOTP({
			headers: event.request.headers,
			body: { code, trustDevice: false }
		});
	} else if (params.method === 'backupCode') {
		const code = params.code.trim();
		if (!code) error(400, 'Enter a backup code.');

		await auth.api.verifyBackupCode({
			headers: event.request.headers,
			body: { code, disableSession: true, trustDevice: false }
		});
	} else {
		error(400, 'Choose a valid verification method.');
	}

	const headers = new Headers(event.request.headers);
	headers.set(VERIFIED_2FA_DISABLE_HEADER, getRuntimeEnv().BETTER_AUTH_SECRET);

	await auth.api.disableTwoFactor({
		headers,
		body: { password: params.password }
	});

	await sendSecurityAlertEmail({
		to: user.email,
		userName: user.name,
		alertType: 'Two-factor authentication disabled',
		message: 'Authenticator app two-factor authentication was disabled for your Stack account.',
		actionUrl: event.url.origin
	});
});

export const sendTotpResetCode = command(async () => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	const code = await beginTotpReset(initDrizzle(), user.id);

	await sendRenderedEmail({
		component: TotpResetCodeEmail,
		props: { userName: user.name, code, expiresInMinutes: TOTP_RESET_CODE_TTL_MS / 60_000 },
		subject: 'Reset your Stack two-factor authentication',
		to: user.email
	});
});

const verifyTotpResetParams = type({ code: 'string' });

export const verifyTotpResetCode = command(verifyTotpResetParams, async (params) => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	await verifyTotpResetEmailCode(initDrizzle(), user.id, params.code);

	return { verified: true };
});

const confirmTotpResetParams = type({ password: 'string', choice: 'string' });

export const confirmTotpResetChoice = command(confirmTotpResetParams, async (params) => {
	const event = getRequestEvent();
	const user = event.locals.user;
	if (!user) error(401, 'Authentication required');

	const choice = normalizeTotpResetChoice(params.choice);
	if (!choice) error(400, 'Choose whether to reset or disable two-factor authentication.');
	if (!params.password) error(400, 'Enter your current password.');

	const db = initDrizzle();
	await requireTotpResetGrant(db, user.id);

	const auth = initAuth();
	const headers = new Headers(event.request.headers);
	headers.set(VERIFIED_2FA_DISABLE_HEADER, getRuntimeEnv().BETTER_AUTH_SECRET);

	await auth.api.disableTwoFactor({
		headers,
		body: { password: params.password }
	});
	await clearTotpResetGrant(db, user.id);

	await sendSecurityAlertEmail({
		to: user.email,
		userName: user.name,
		alertType:
			choice === 'reset' ? 'Two-factor authentication reset' : 'Two-factor authentication disabled',
		message:
			choice === 'reset'
				? 'Authenticator app two-factor authentication was reset for your Stack account. Set up your new authenticator app to finish securing your account.'
				: 'Authenticator app two-factor authentication was disabled for your Stack account.',
		actionUrl: event.url.origin
	});

	return { choice };
});
