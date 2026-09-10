export type ServerInfo = {
	id: string;
	name: string;
	liveLoaded: boolean;
	vcpu: number;
	ram: string;
	disk: string;
	ip: string;
	ipv6: string;
	status: 'running' | 'stopped' | 'restarting' | 'provisioning' | 'deleting' | 'error' | 'unknown';
	agentConnected: boolean;
	region: string;
	created: string;
	uptime: string;
	plan: string;
	backups: boolean;
	metrics: {
		cpu?: number | null;
		memory?: number | null;
		disk?: number | null;
		networkIn?: number | null;
		networkOut?: number | null;
		diskRead?: number | null;
		diskWrite?: number | null;
	} | null;
};

export const serversState = $state({
	projectId: null as string | null,
	servers: [] as ServerInfo[],
	loading: false,
	statusRefreshing: false,
	firstStatusRefreshComplete: false,
	refreshVersion: 0
});

export function sortServers(items: ServerInfo[]): ServerInfo[] {
	return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

export function syncServers(projectId: string | null, incoming: ServerInfo[]): void {
	const sameProject = serversState.projectId === projectId;
	const currentById = new Map(
		(sameProject ? serversState.servers : []).map((server) => [server.id, server])
	);
	serversState.servers = sortServers(
		incoming.map((server) => {
			const current = currentById.get(server.id);
			if (!current?.liveLoaded) return server;

			// List data contains cached snapshots. Keep fresher live values during invalidation.
			return {
				...server,
				liveLoaded: true,
				status:
					server.status === 'deleting' ||
					server.status === 'error' ||
					server.status === 'provisioning'
						? server.status
						: current.status,
				agentConnected: current.agentConnected,
				ip: current.ip === '-' ? server.ip : current.ip,
				ipv6: current.ipv6 === '-' ? server.ipv6 : current.ipv6,
				uptime: current.uptime === '-' ? server.uptime : current.uptime,
				metrics: current.metrics ?? server.metrics
			};
		})
	);
	serversState.projectId = projectId;
	serversState.loading = false;
	serversState.firstStatusRefreshComplete =
		incoming.length === 0 || (sameProject && serversState.firstStatusRefreshComplete);
}

export function requestServerStatusRefresh(): void {
	serversState.refreshVersion += 1;
}

export function getServer(id: string): ServerInfo | null {
	return serversState.servers.find((server) => server.id === id) ?? null;
}

export function getServerWithFallback(id: string, fallback: ServerInfo): ServerInfo {
	const server = getServer(id);
	if (!server) return fallback;
	if (!server.liveLoaded && fallback.liveLoaded) return fallback;
	return server;
}

export function upsertServer(server: ServerInfo): void {
	const index = serversState.servers.findIndex((item) => item.id === server.id);

	if (index === -1) {
		serversState.servers = sortServers([...serversState.servers, server]);
		return;
	}

	serversState.servers[index] = {
		...serversState.servers[index],
		...server
	};
}
