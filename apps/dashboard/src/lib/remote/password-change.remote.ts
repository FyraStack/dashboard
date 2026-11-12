import { type } from 'arktype';
import { backend, withSetCookie } from '#lib/server/backend.js';
import { command } from '$app/server';

export const sendPasswordChangeCode = command(async () => {
	await backend((me) => me.account().sendPasswordChangeCode());
});

export const hasPassword = command(() => backend((me) => me.account().hasPassword()));

const passwordFields = { currentPassword: 'string', newPassword: 'string' } as const;
const codeParams = type({ ...passwordFields, code: 'string' });

export const confirmPasswordChangeWithEmail = command(codeParams, (input) =>
	withSetCookie((me) => me.account().changePasswordWithEmail(input))
);

export const confirmPasswordChangeWithTotp = command(codeParams, (input) =>
	withSetCookie((me) => me.account().changePasswordWithTotp(input))
);

export const confirmPasswordChangeWithPasskey = command(type(passwordFields), (input) =>
	withSetCookie((me) => me.account().changePasswordWithPasskey(input))
);
