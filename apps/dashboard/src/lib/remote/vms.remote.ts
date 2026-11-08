import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureServers
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listVms = query(type({ projectId: 'string' }), async ({ projectId }) => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureServers;
	}
	return await backend((me) => me.project(projectId).listVms());
});

export const getVm = query(type({ vmId: 'string' }), async ({ vmId }) => {
	if (accessibilityFixtureEnabled) {
		const server = accessibilityFixtureServers.find((item) => item.id === vmId);
		if (!server) {
			error(404, `VM "${vmId}" not found`);
		}
		return server;
	}
	return await backend((me) => me.vm(vmId).get());
});

const metricsHistoryParams = type({
	vmId: 'string',
	timeframe: "'hour' | 'day' | 'week' | 'month' | 'year'?"
});
export const getVmMetricsHistory = query(metricsHistoryParams, async ({ vmId, timeframe }) => {
	if (accessibilityFixtureEnabled) {
		return [
			{ time: Date.now() - 120_000, cpu: 0.18, memory: 0.41, bandwidth: 2048, diskIo: 256 },
			{ time: Date.now() - 60_000, cpu: 0.2, memory: 0.42, bandwidth: 4096, diskIo: 512 }
		];
	}
	return await backend((me) => me.vm(vmId).metricsHistory({ timeframe }));
});

export const listVmStatuses = query(type({ projectId: 'string' }), async ({ projectId }) => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureServers.map((server) => ({
			id: server.id,
			status: 'running' as const,
			liveStatus: server.live.status,
			uptime: server.live.uptime,
			memory: server.live.memory,
			disk: server.live.disk,
			networkInterfaces: server.live.networkInterfaces,
			metrics: server.live.metrics
		}));
	}
	return await backend((me) => me.project(projectId).listVmStatuses());
});

const createParams = type({
	projectId: 'string',
	vmTypeId: 'string',
	name: 'string',
	networkingMode: "'both' | 'ipv6'?",
	imageId: 'string?',
	sshKeyIds: 'string[]?',
	password: 'string?',
	idempotencyKey: '0 < string <= 128'
});
export const createVm = command(createParams, ({ projectId, ...input }) =>
	backend((me) => me.project(projectId).createVm(input))
);

const renameParams = type({ vmId: 'string', name: 'string', updateHostname: 'boolean' });
export const renameVm = command(renameParams, ({ vmId, ...input }) =>
	backend((me) => me.vm(vmId).rename(input))
);

export const deleteVm = command(type({ vmId: 'string' }), ({ vmId }) =>
	backend((me) => me.vm(vmId).delete())
);

const powerParams = type({ vmId: 'string' });
export const startVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).start()));
export const stopVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).stop()));
export const killVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).kill()));
export const rebootVm = command(powerParams, ({ vmId }) => backend((me) => me.vm(vmId).reboot()));

export const resizeVm = command(
	type({ vmId: 'string', vmTypeId: 'string' }),
	({ vmId, vmTypeId }) => backend((me) => me.vm(vmId).resize({ vmTypeId }))
);
