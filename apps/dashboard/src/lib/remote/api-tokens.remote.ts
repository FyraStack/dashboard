import { type } from 'arktype';
import { idempotencyKeySchema } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listApiTokens = query(() => backend((me) => me.account().listApiTokens()));

const createParams = type({ name: 'string', idempotencyKey: idempotencyKeySchema });

export const createApiToken = command(createParams, ({ idempotencyKey, name }) =>
	backend((me) => me.account().createApiToken({ idempotencyKey, name }))
);

const revokeParams = type({ tokenId: 'string' });

export const revokeApiToken = command(revokeParams, ({ tokenId }) =>
	backend((me) => me.account().revokeApiToken({ tokenId }))
);
