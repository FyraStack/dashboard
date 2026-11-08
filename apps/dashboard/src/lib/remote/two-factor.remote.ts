import { type } from 'arktype';
import { applySetCookies, backend } from '#lib/server/backend.js';
import { command } from '$app/server';

const disableTwoFactorParams = type({ password: 'string', method: 'string', code: 'string' });

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

const confirmTotpResetParams = type({ password: 'string', choice: 'string' });

export const confirmTotpResetChoice = command(confirmTotpResetParams, ({ choice, password }) =>
	backend((me) => me.twoFactorReset().confirmChoice({ choice, password }))
);
