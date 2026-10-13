import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, gt, sql } from 'drizzle-orm';
import TotpResetCodeEmail from '#lib/emails/totp-reset-code.svelte';
import { initAuth, VERIFIED_2FA_DISABLE_HEADER } from '#lib/server/auth.js';
import { verification } from '#lib/server/db/auth.schema.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { sendSecurityAlertEmail } from '#lib/server/email-notifications.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { ulid } from '#lib/server/id.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import {
	beginTotpReset,
	consumeTotpResetGrantAndRemoveTotp,
	discardTotpResetCode,
	normalizeTotpResetChoice,
	requireTotpResetGrant,
	resolvePendingTwoFactorUser,
	TOTP_RESET_CODE_TTL_MS,
	type TotpResetUser,
	verifyTotpResetCode as verifyTotpResetEmailCode,
	verifyTotpResetPassword
} from '#lib/server/totp-reset.js';
import { command, getRequestEvent } from '$app/server';

const CODE_LENGTH = 6;
const SECURITY_ALERT_DEDUPE_MS = 5 * 60 * 1000;

function claimSecurityAlert(db: Database, key: string) {
	const identifier = `security-alert:${key}`;
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
		const now = new Date();
		const [existing] = await tx
			.select({ id: verification.id })
			.from(verification)
			.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
			.limit(1);
		if (existing) {
			return false;
		}
		await tx.delete(verification).where(eq(verification.identifier, identifier));
		await tx.insert(verification).values({
			id: ulid(),
			identifier,
			value: 'sent',
			expiresAt: new Date(now.getTime() + SECURITY_ALERT_DEDUPE_MS)
		});
		return true;
	});
}

async function sendSecurityAlertSafely(params: Parameters<typeof sendSecurityAlertEmail>[0]) {
	try {
		await sendSecurityAlertEmail(params);
	} catch (err) {
		console.error('Failed to send security alert email', err);
	}
}

const disableTwoFactorParams = type({ password: 'string', method: 'string', code: 'string' });

export const disableTwoFactorWithVerification = command(disableTwoFactorParams, async (params) => {
	const event = getRequestEvent();
	const { user } = event.locals;
	if (!user) {
		error(401, 'Authentication required');
	}

	if (!params.password) {
		error(400, 'Enter your current password.');
	}

	const auth = initAuth();
	if (params.method === 'totp') {
		const code = params.code.replace(/\D/g, '');
		if (code.length !== CODE_LENGTH) {
			error(400, 'Enter the verification code from your authenticator app.');
		}

		await auth.api.verifyTOTP({
			headers: event.request.headers,
			body: { code, trustDevice: false }
		});
	} else if (params.method === 'backupCode') {
		const code = params.code.trim();
		if (!code) {
			error(400, 'Enter a backup code.');
		}

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

	if (await claimSecurityAlert(initDrizzle(), `two-factor-disabled:${user.id}`)) {
		await sendSecurityAlertSafely({
			to: user.email,
			userName: user.name,
			alertType: 'Two-factor authentication disabled',
			message: 'Authenticator app two-factor authentication was disabled for your Stack account.',
			actionUrl: event.url.origin
		});
	}
	captureServerEvent('two_factor_disabled', { verification_method: params.method });
});

async function resolveTotpResetUser(
	event: ReturnType<typeof getRequestEvent>,
	db: ReturnType<typeof initDrizzle>
): Promise<TotpResetUser> {
	if (event.locals.user) {
		error(403, 'Two-factor authentication cannot be reset while signed in.');
	}

	const pending = await resolvePendingTwoFactorUser(event, db, getRuntimeEnv().BETTER_AUTH_SECRET);
	if (!pending) {
		error(401, 'Authentication required');
	}
	return pending;
}

export const sendTotpResetCode = command(async () => {
	const event = getRequestEvent();
	const db = initDrizzle();
	const user = await resolveTotpResetUser(event, db);

	const { code, id } = await beginTotpReset(db, user.id);

	try {
		await sendRenderedEmail({
			component: TotpResetCodeEmail,
			props: { userName: user.name, code, expiresInMinutes: TOTP_RESET_CODE_TTL_MS / 60_000 },
			subject: 'Reset your Stack two-factor authentication',
			to: user.email
		});
	} catch (err) {
		await discardTotpResetCode(db, id);
		throw err;
	}
});

const verifyTotpResetParams = type({ code: 'string' });

export const verifyTotpResetCode = command(verifyTotpResetParams, async (params) => {
	const event = getRequestEvent();
	const db = initDrizzle();
	const user = await resolveTotpResetUser(event, db);

	await verifyTotpResetEmailCode(db, user.id, params.code);

	return { verified: true };
});

const confirmTotpResetParams = type({ password: 'string', choice: 'string' });

export const confirmTotpResetChoice = command(confirmTotpResetParams, async (params) => {
	const event = getRequestEvent();
	const db = initDrizzle();
	const user = await resolveTotpResetUser(event, db);

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
	await verifyTotpResetPassword(db, user.id, params.password, (hash, password) =>
		authContext.password.verify({ hash, password })
	);
	if (!(await consumeTotpResetGrantAndRemoveTotp(db, user.id))) {
		error(400, 'Verify your email before changing two-factor authentication.');
	}
	await sendSecurityAlertSafely({
		to: user.email,
		userName: user.name,
		alertType:
			choice === 'reset' ? 'Two-factor authentication reset' : 'Two-factor authentication disabled',
		message:
			choice === 'reset'
				? 'Authenticator app two-factor authentication was reset for your Stack account during sign-in. The old authenticator no longer works. Finish setting up the new one to turn two-factor authentication back on.'
				: 'Authenticator app two-factor authentication was disabled for your Stack account during sign-in.',
		actionUrl: event.url.origin
	});
	captureServerEvent('totp_reset_completed', { choice }, { distinctId: user.id });
	return { choice, signInEmail: user.email };
});
