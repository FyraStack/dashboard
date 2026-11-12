import type { listVmStatuses } from '#lib/remote/vms.remote.js';
import { mergeListWithLive, mergeLive, type ServerInfo, toServerLive } from '#lib/server-info.js';
import { isListedStatus } from '#lib/vm-status.js';

export const serversState = $state({
	projectId: null as string | null,
	servers: [] as ServerInfo[],
	statusRefreshing: false,
	firstStatusRefreshComplete: false,
	refreshVersion: 0
});

export function syncServers(projectId: string | null, incoming: ServerInfo[]): void {
	const sameProject = serversState.projectId === projectId;
	const currentById = new Map(
		(sameProject ? serversState.servers : []).map((server) => [server.id, server])
	);
	serversState.servers = incoming.map((server) => {
		const current = currentById.get(server.id);
		return current?.liveLoaded ? mergeListWithLive(server, current) : server;
	});
	serversState.projectId = projectId;
	serversState.firstStatusRefreshComplete =
		incoming.length === 0 || (sameProject && serversState.firstStatusRefreshComplete);
}

export function applyLiveStatuses(
	statuses: Awaited<ReturnType<typeof listVmStatuses>>,
	requestedServerIds: Set<string>
): void {
	const statusById = new Map(statuses.map((status) => [status.id, status]));
	serversState.servers = serversState.servers
		.filter((server) => statusById.has(server.id) || !requestedServerIds.has(server.id))
		.map((server) => {
			const status = statusById.get(server.id);
			return status ? mergeLive(server, toServerLive(status)) : server;
		});
}

export function listedServers(projectId: string, initial: ServerInfo[]): ServerInfo[] {
	return (serversState.projectId === projectId ? serversState.servers : initial).filter((server) =>
		isListedStatus(server.status)
	);
}

export function requestServerStatusRefresh(): void {
	serversState.refreshVersion += 1;
}

export function getServer(id: string): ServerInfo | null {
	return serversState.servers.find((server) => server.id === id) ?? null;
}

export function getServerWithFallback(id: string, fallback: ServerInfo): ServerInfo {
	const server = getServer(id);
	if (!server) {
		return fallback;
	}
	if (!server.liveLoaded && fallback.liveLoaded) {
		return fallback;
	}
	return server;
}
