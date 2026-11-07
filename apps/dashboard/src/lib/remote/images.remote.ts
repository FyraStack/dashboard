import { type } from 'arktype';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureImages
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listImages = query(async () => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureImages;
	}
	return await backend((me) => me.listImages());
});

const createParams = type({
	name: 'string',
	version: 'string',
	description: 'string',
	icon: 'string?',
	color: 'string?',
	isOfficial: 'boolean?',
	logoSvg: 'string?',
	accentColor: 'string?',
	secureBoot: 'boolean?',
	filePath: 'string',
	isa: "'x86'"
});
export const createImage = command(createParams, (input) =>
	backend((me) => me.admin().images().create(input))
);

const updateParams = type({
	imageId: 'string',
	name: 'string?',
	version: 'string?',
	description: 'string?',
	icon: 'string?',
	color: 'string?',
	isOfficial: 'boolean?',
	logoSvg: 'string?',
	accentColor: 'string?',
	secureBoot: 'boolean?',
	filePath: 'string?',
	isa: "'x86'?"
});
export const updateImage = command(updateParams, (input) =>
	backend((me) => me.admin().images().update(input))
);

export const reorderImages = command(type({ imageIds: 'string[]' }), ({ imageIds }) =>
	backend((me) => me.admin().images().reorder({ imageIds }))
);

export const deleteImage = command(type({ imageId: 'string' }), ({ imageId }) =>
	backend((me) => me.admin().images().delete({ imageId }))
);

export const listProxmoxImages = query(() => backend((me) => me.admin().images().listProxmox()));

export const listProxmoxImageImportTargets = query(() =>
	backend((me) => me.admin().images().listImportTargets())
);

const importUrlParams = type({
	url: 'string',
	filename: 'string',
	storage: 'string?',
	checksum: 'string?',
	checksumAlgorithm: "'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512'?",
	verifyCertificates: 'boolean?'
});
export const importProxmoxImageFromUrl = command(importUrlParams, (input) =>
	backend((me) => me.admin().images().importFromUrl(input))
);

export const getProxmoxTaskStatus = query(
	type({ node: 'string', upid: 'string' }),
	({ node, upid }) => backend((me) => me.admin().images().taskStatus({ node, upid }))
);
