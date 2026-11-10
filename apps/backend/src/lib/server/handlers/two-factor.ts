import TotpResetCodeEmail from '#lib/emails/totp-reset-code.svelte';
import { initAuth, VERIFIED_2FA_DISABLE_HEADER } from '#lib/server/auth.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { sendSecurityAlertEmail } from '#lib/server/email-notifications.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { withStepUpAttemptLimit } from '#lib/server/step-up.js';
import {
	beginTotpReset,
	clearTotpResetGrant,
	normalizeTotpResetChoice,
	removeTotpWithVerifiedPassword,
	requireTotpResetGrant,
	resolvePendingTwoFactorUser,
	TOTP_RESET_CODE_TTL_MS,
	type TotpResetUser,
	verifyTotpResetCode as verifyTotpResetEmailCode
} from '#lib/server/totp-reset.js';

const CODE_LENGTH = 6;

export interface DisableTwoFactorWithVerificationInput {
	code: string;
	method: string;
	password: string;
}
export interface VerifyTotpResetCodeInput {
	code: string;
}
export interface ConfirmTotpResetChoiceInput {
	choice: string;
	password: string;
}

export async function disableTwoFactorWithVerification(
	params: DisableTwoFactorWithVerificationInput
) {
	const { locals, request, url } = context();
	const { user } = locals;
	if (!user) {
		error(401, 'Authentication required');
	}

	if (!params.password) {
		error(400, 'Enter your current password.');
	}

	const auth = initAuth();
	const setCookie: string[] = [];
	if (params.method === 'totp') {
		const code = params.code.replace(/\D/g, '');
		if (code.length !== CODE_LENGTH) {
			error(400, 'Enter the verification code from your authenticator app.');
		}

		const verified = await withStepUpAttemptLimit(initDrizzle(), user.id, () =>
			auth.api.verifyTOTP({
				headers: request.headers,
				body: { code, trustDevice: false },
				returnHeaders: true
			})
		);
		setCookie.push(...verified.headers.getSetCookie());
	} else if (params.method === 'backupCode') {
		const code = params.code.trim();
		if (!code) {
			error(400, 'Enter a backup code.');
		}

		const verified = await withStepUpAttemptLimit(initDrizzle(), user.id, () =>
			auth.api.verifyBackupCode({
				headers: request.headers,
				body: { code, disableSession: true, trustDevice: false },
				returnHeaders: true
			})
		);
		setCookie.push(...verified.headers.getSetCookie());
	} else {
		error(400, 'Choose a valid verification method.');
	}

	const headers = new Headers(request.headers);
	headers.set(VERIFIED_2FA_DISABLE_HEADER, getRuntimeEnv().BETTER_AUTH_SECRET);

	const disabled = await auth.api.disableTwoFactor({
		headers,
		body: { password: params.password },
		returnHeaders: true
	});
	setCookie.push(...disabled.headers.getSetCookie());

	await sendSecurityAlertEmail({
		to: user.email,
		userName: user.name,
		alertType: 'Two-factor authentication disabled',
		message: 'Authenticator app two-factor authentication was disabled for your Stack account.',
		actionUrl: url.origin
	});
	captureServerEvent('two_factor_disabled', { verification_method: params.method });

	return { setCookie };
}

async function resolveTotpResetUser(db: ReturnType<typeof initDrizzle>): Promise<TotpResetUser> {
	const event = context();
	if (event.locals.user) {
		error(403, 'Two-factor authentication cannot be reset while signed in.');
	}

	const pending = await resolvePendingTwoFactorUser(event, db, getRuntimeEnv().BETTER_AUTH_SECRET);
	if (!pending) {
		error(401, 'Authentication required');
	}
	return pending;
}

export async function sendTotpResetCode() {
	const db = initDrizzle();
	const user = await resolveTotpResetUser(db);

	const code = await beginTotpReset(db, user.id);

	await sendRenderedEmail({
		component: TotpResetCodeEmail,
		props: { userName: user.name, code, expiresInMinutes: TOTP_RESET_CODE_TTL_MS / 60_000 },
		subject: 'Reset your Stack two-factor authentication',
		to: user.email
	});
}

export async function verifyTotpResetCode(params: VerifyTotpResetCodeInput) {
	const db = initDrizzle();
	const user = await resolveTotpResetUser(db);

	await verifyTotpResetEmailCode(db, user.id, params.code);

	return { verified: true };
}

export async function confirmTotpResetChoice(params: ConfirmTotpResetChoiceInput) {
	const db = initDrizzle();
	const user = await resolveTotpResetUser(db);

	const choice = normalizeTotpResetChoice(params.choice);
	if (!choice) {
		error(400, 'Choose whether to reset or disable two-factor authentication.');
	}
	if (!params.password) {
		error(400, 'Enter your current password.');
	}

	await requireTotpResetGrant(db, user.id);

	const auth = initAuth();
	const authContext = await auth.$context;
	await withStepUpAttemptLimit(db, user.id, () =>
		removeTotpWithVerifiedPassword(db, user.id, params.password, (hash, password) =>
			authContext.password.verify({ hash, password })
		)
	);
	await clearTotpResetGrant(db, user.id);
	await sendSecurityAlertEmail({
		to: user.email,
		userName: user.name,
		alertType:
			choice === 'reset' ? 'Two-factor authentication reset' : 'Two-factor authentication disabled',
		message:
			choice === 'reset'
				? 'Authenticator app two-factor authentication was reset for your Stack account during sign-in. The old authenticator no longer works. Finish setting up the new one to turn two-factor authentication back on.'
				: 'Authenticator app two-factor authentication was disabled for your Stack account during sign-in.',
		actionUrl: context().url.origin
	});
	captureServerEvent('totp_reset_completed', { choice }, { distinctId: user.id });
	return { choice, signInEmail: user.email };
}
