import type { PageLoad } from './$types';
import { getVmMetricsHistory } from '$lib/remote/vms.remote';
import { clientTimingLog } from '$lib/utils';

export const load: PageLoad = async ({ params }) => {
	const started = performance.now();
	clientTimingLog('server.detail.page.load.start', { 'vm.id': params.id });
	const metricsHistory = await getVmMetricsHistory({ vmId: params.id, timeframe: 'hour' }).catch(
		(error) => {
			clientTimingLog('server.detail.page.metrics.error', {
				'vm.id': params.id,
				duration_ms: Math.round((performance.now() - started) * 100) / 100,
				'error.name': error instanceof Error ? error.name : typeof error
			});
			console.warn(`Failed to load VM metrics history for ${params.id}`, error);
			return [];
		}
	);

	clientTimingLog('server.detail.page.load.end', {
		'vm.id': params.id,
		'vm.metrics.count': metricsHistory.length,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return { metricsHistory };
};
