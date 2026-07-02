import type { LayoutLoad } from './$types';
import type { ServerInfo } from '../lib/server-summary';
import { error } from '@sveltejs/kit';
import { getVm } from '$lib/remote/vms.remote';
import { vpsServerTabFeatureFlags } from '$lib/feature-flags';
import { toServerInfo } from '../lib/server-summary';
import { clientTimingLog } from '$lib/utils';

export const load: LayoutLoad = async ({ params, parent, url }) => {
	const started = performance.now();
	clientTimingLog('server.detail.layout.load.start', {
		'vm.id': params.id,
		'url.pathname': url.pathname
	});
	const { featureFlags, projectId } = await parent();
	clientTimingLog('server.detail.layout.parent.end', {
		'vm.id': params.id,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	const tab = url.pathname.split('/').pop();
	const featureFlag = vpsServerTabFeatureFlags[tab as keyof typeof vpsServerTabFeatureFlags];

	if (featureFlag && !featureFlags[featureFlag]) {
		error(404, 'Not found');
	}

	if (!projectId) {
		error(404, 'Project not found');
	}

	const getVmStarted = performance.now();
	clientTimingLog('server.detail.layout.getVm.start', { 'vm.id': params.id });
	const vm = await getVm({ vmId: params.id });
	clientTimingLog('server.detail.layout.getVm.end', {
		'vm.id': params.id,
		duration_ms: Math.round((performance.now() - getVmStarted) * 100) / 100
	});

	if (vm.ownerProjectId !== projectId) error(404, `VM "${params.id}" not found`);

	const server = toServerInfo(vm);
	clientTimingLog('server.detail.layout.load.end', {
		'vm.id': params.id,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return {
		server: server as ServerInfo,
		serverId: params.id
	};
};
