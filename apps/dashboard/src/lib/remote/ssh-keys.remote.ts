import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listSshKeys = query(() => backend((me) => me.account().listSshKeys()));

const createParams = type({
	name: 'string',
	publicKey: 'string',
	description: 'string?',
	idempotencyKey: '0 < string <= 128'
});

export const createSshKey = command(createParams, (params) =>
	backend((me) => me.account().createSshKey(params))
);

const deleteParams = type({ keyId: 'string' });
export const deleteSshKey = command(deleteParams, ({ keyId }) =>
	backend((me) => me.account().deleteSshKey({ keyId }))
);
