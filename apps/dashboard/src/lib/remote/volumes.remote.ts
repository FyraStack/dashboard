import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listVolumes = query(type({ projectId: 'string' }), ({ projectId }) =>
	backend((me) => me.project(projectId).listVolumes())
);

const createParams = type({
	projectId: 'string',
	name: 'string',
	size: 'number',
	backend: 'string?'
});
export const createVolume = command(createParams, ({ projectId, ...input }) =>
	backend((me) => me.project(projectId).createVolume(input))
);

export const deleteVolume = command(type({ volumeId: 'string' }), ({ volumeId }) =>
	backend((me) => me.volume(volumeId).delete())
);

export const attachVolume = command(
	type({ volumeId: 'string', vmId: 'string' }),
	({ volumeId, vmId }) => backend((me) => me.volume(volumeId).attach({ vmId }))
);

export const detachVolume = command(type({ volumeId: 'string' }), ({ volumeId }) =>
	backend((me) => me.volume(volumeId).detach())
);
