import { type } from 'arktype';
import { totpResetChoices, twoFactorDisableMethods } from 'stack-shared/auth';
import { applySetCookies, backend } from '#lib/server/backend.js';
import { TOTP_RESET_UI_CHOICES } from '#lib/totp-reset-flow.js';
import { command } from '$app/server';

const disableTwoFactorParams = type({
	password: 'string',
	method: type.enumerated(...twoFactorDisableMethods),
	code: 'string'
});

export const disableTwoFactorWithVerification = command(
	disableTwoFactorParams,
	async ({ code, method, password }) => {
		const { setCookie } = await backend((me) =>
			me.account().disableTwoFactor({ code, method, password })
		);
		applySetCookies(setCookie);
	}
);

export const sendTotpResetCode = command(async () => {
	await backend((me) => me.twoFactorReset().sendCode());
});

const verifyTotpResetParams = type({ code: 'string' });

export const verifyTotpResetCode = command(verifyTotpResetParams, ({ code }) =>
	backend((me) => me.twoFactorReset().verifyCode({ code }))
);

const confirmTotpResetParams = type({
	password: 'string',
	choice: type.enumerated(...totpResetChoices, ...TOTP_RESET_UI_CHOICES)
});

export const confirmTotpResetChoice = command(confirmTotpResetParams, ({ choice, password }) =>
	backend((me) => me.twoFactorReset().confirmChoice({ choice, password }))
);
