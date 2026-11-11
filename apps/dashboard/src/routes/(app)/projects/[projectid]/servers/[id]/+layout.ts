import { error } from '@sveltejs/kit';
import { vpsServerTabFeatureFlags } from 'stack-shared/feature-flags';
import { requireFeature } from '#lib/feature-gate.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, parent, url }) => {
	const tab = url.pathname.split('/').pop();
	const featureFlag = vpsServerTabFeatureFlags[tab as keyof typeof vpsServerTabFeatureFlags];
	if (featureFlag) {
		await requireFeature(parent, featureFlag);
	}

	const { servers } = await parent();

	const server = servers.find((item) => item.id === params.id);
	if (!server) {
		error(404, `VM "${params.id}" not found`);
	}

	return {
		server,
		serverId: params.id,
		vmTypeId: server.vmTypeId,
		vmType: server.vmType
	};
};
