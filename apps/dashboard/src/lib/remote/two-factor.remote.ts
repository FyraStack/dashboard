import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { initAuth, VERIFIED_2FA_DISABLE_HEADER } from '$lib/server/auth';
import { sendSecurityAlertEmail } from '$lib/server/email-notifications';
import { getRuntimeEnv } from '$lib/server/env';

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
