import { type } from 'arktype';
import { twoFactorDisableMethods } from 'stack-shared/auth';
import { totpResetChoice } from '#lib/remote/schemas.js';
import { backend, withSetCookie } from '#lib/server/backend.js';
import { command } from '$app/server';

const disableTwoFactorParams = type({
	password: 'string',
	method: type.enumerated(...twoFactorDisableMethods),
	code: 'string'
});

export const disableTwoFactorWithVerification = command(disableTwoFactorParams, (input) =>
	withSetCookie((me) => me.account().disableTwoFactor(input))
);

export const sendTotpResetCode = command(async () => {
	await backend((me) => me.twoFactorReset().sendCode());
});

const verifyTotpResetParams = type({ code: 'string' });

export const verifyTotpResetCode = command(verifyTotpResetParams, ({ code }) =>
	backend((me) => me.twoFactorReset().verifyCode({ code }))
);

const confirmTotpResetParams = type({ password: 'string', choice: totpResetChoice });

export const confirmTotpResetChoice = command(confirmTotpResetParams, ({ choice, password }) =>
	backend((me) => me.twoFactorReset().confirmChoice({ choice, password }))
);
