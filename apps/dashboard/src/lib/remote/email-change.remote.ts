import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

const emailChangeParams = type({ newEmail: 'string', callbackURL: 'string' });

export const getPendingEmailChange = query(() =>
	backend((me) => me.account().pendingEmailChange())
);

export const requestEmailChange = command(emailChangeParams, ({ callbackURL, newEmail }) =>
	backend((me) => me.account().requestEmailChange({ callbackURL, newEmail }))
);
