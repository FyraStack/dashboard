import type { LayoutLoad } from './$types';
import { error } from '@sveltejs/kit';
import { vpsServerTabFeatureFlags } from '$lib/feature-flags';

export const load: LayoutLoad = async ({ params, parent, url }) => {
	const { featureFlags, projectId, servers } = await parent();
	const tab = url.pathname.split('/').pop();
	const featureFlag = vpsServerTabFeatureFlags[tab as keyof typeof vpsServerTabFeatureFlags];

	if (featureFlag && !featureFlags[featureFlag]) {
		error(404, 'Not found');
	}

	if (!projectId) {
		error(404, 'Project not found');
	}

	// The parent already checked project access and loaded these VM summaries.
	// Live state is refreshed by the server list without blocking tab navigation.
	const server = servers.find((item) => item.id === params.id);
	if (!server) error(404, `VM "${params.id}" not found`);

	return {
		server,
		serverId: params.id,
		vmTypeId: server.vmTypeId,
		vmType: server.vmType
	};
};
