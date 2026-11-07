import { type } from 'arktype';
import { applySetCookies, backend } from '#lib/server/backend.js';
import { command } from '$app/server';

export const sendPasswordChangeCode = command(async () => {
	await backend((me) => me.account().sendPasswordChangeCode());
});

const emailParams = type({ currentPassword: 'string', newPassword: 'string', code: 'string' });

export const hasPassword = command(() => backend((me) => me.account().hasPassword()));

export const confirmPasswordChangeWithEmail = command(
	emailParams,
	async ({ code, currentPassword, newPassword }) => {
		const { setCookie } = await backend((me) =>
			me.account().changePasswordWithEmail({ code, currentPassword, newPassword })
		);
		applySetCookies(setCookie);
	}
);

const totpParams = type({ currentPassword: 'string', newPassword: 'string', code: 'string' });

export const confirmPasswordChangeWithTotp = command(
	totpParams,
	async ({ code, currentPassword, newPassword }) => {
		const { setCookie } = await backend((me) =>
			me.account().changePasswordWithTotp({ code, currentPassword, newPassword })
		);
		applySetCookies(setCookie);
	}
);

const passkeyParams = type({ currentPassword: 'string', newPassword: 'string' });

export const confirmPasswordChangeWithPasskey = command(
	passkeyParams,
	async ({ currentPassword, newPassword }) => {
		const { setCookie } = await backend((me) =>
			me.account().changePasswordWithPasskey({ currentPassword, newPassword })
		);
		applySetCookies(setCookie);
	}
);
