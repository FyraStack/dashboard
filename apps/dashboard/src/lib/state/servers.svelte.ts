export type ServerInfo = {
	id: string;
	name: string;
	liveLoaded: boolean;
	vcpu: number;
	ram: string;
	disk: string;
	ip: string;
	ipv6: string;
	status: 'running' | 'stopped' | 'restarting' | 'provisioning' | 'deleting' | 'unknown';
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
	servers: [] as ServerInfo[],
	loading: false,
	statusRefreshing: false,
	firstStatusRefreshComplete: false
});

export function sortServers(items: ServerInfo[]): ServerInfo[] {
	return [...items].sort((a, b) => a.id.localeCompare(b.id));
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
