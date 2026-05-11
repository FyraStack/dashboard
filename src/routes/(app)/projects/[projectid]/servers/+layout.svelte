<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { HardDrive, Plus } from '@lucide/svelte';
	import { listVmStatuses } from '$lib/remote/vms.remote';
	import { serversState, sortServers } from '$lib/state/servers.svelte';

	let { data, children } = $props();

	function formatUptime(seconds: number): string {
		if (!seconds) return '—';
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return `${d}d ${h}h ${m}m`;
	}

	function getFirstIp(
		networkInterfaces: Record<string, { ipAddresses?: string[] | null }> | null | undefined,
		match: (address: string) => boolean
	): string | null {
		return (
			Object.values(networkInterfaces ?? {})
				.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
				.find((address) => address && match(address)) ?? null
		);
	}

	const initialServers = $derived(data.servers ?? []);
	let projectId = $derived(data.projectId ?? null);
	let refreshTimeout: number | null = null;

	function scheduleRefreshStatuses() {
		if (refreshTimeout) window.clearTimeout(refreshTimeout);
		refreshTimeout = window.setTimeout(() => {
			refreshTimeout = null;
			refreshStatuses();
		}, 500);
	}

	function cancelScheduledRefreshStatuses() {
		if (!refreshTimeout) return;
		window.clearTimeout(refreshTimeout);
		refreshTimeout = null;
	}

	$effect(() => {
		serversState.servers = sortServers(initialServers);
		serversState.loading = false;
		serversState.firstStatusRefreshComplete = initialServers.length === 0;
	});

	async function refreshStatuses() {
		if (!projectId) return;
		serversState.statusRefreshing = true;

		try {
			const statuses = await listVmStatuses({ projectId }).run();
			const byId = new Map(statuses.map((server) => [server.id, server]));

			untrack(() => {
				serversState.servers = sortServers(serversState.servers).map((server) => {
					const next = byId.get(server.id);
					if (!next) return server;

					const ipv4 =
						getFirstIp(
							next.networkInterfaces,
							(address) => !address.startsWith('127.') && !address.includes(':')
						) ?? server.ip;
					const ipv6 =
						getFirstIp(next.networkInterfaces, (address) => address.includes(':')) ?? server.ipv6;

					return {
						...server,
						liveLoaded: true,
						status:
							next.status === 'running'
								? 'running'
								: server.status === 'provisioning' || server.status === 'restarting'
									? server.status
									: next.status,
						agentConnected: next.liveStatus === 'running',
						ip: ipv4,
						ipv6,
						uptime: formatUptime(next.uptime),
						metrics: next.metrics
					};
				});
			});
		} catch {
		} finally {
			serversState.statusRefreshing = false;
			serversState.firstStatusRefreshComplete = true;
		}
	}

	$effect(() => {
		if (!projectId) return;

		untrack(() => {
			refreshStatuses();
		});
		const interval = window.setInterval(scheduleRefreshStatuses, 5000);

		return () => {
			cancelScheduledRefreshStatuses();
			window.clearInterval(interval);
		};
	});

	$effect(() => {
		if (
			!projectId ||
			serversState.loading ||
			serversState.servers.length === 0 ||
			currentPath !== serversPath
		)
			return;
		goto(`${serversPath}/${serversState.servers[0].id}`, { replaceState: true });
	});

	const currentPath = $derived(page.url.pathname);
	const serversPath = $derived(`/projects/${projectId}/servers`);
	const isCreatePage = $derived(currentPath === `${serversPath}/create`);
	const selectedServerId = $derived(
		isCreatePage
			? null
			: currentPath.startsWith(`${serversPath}/`)
				? currentPath.split('/').pop()
				: null
	);
</script>

<div class="flex h-full w-full overflow-hidden">
	<!-- Server list sidebar -->
	<div class="flex w-64 shrink-0 flex-col border-r border-gray-800">
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-4">
			<div class="flex items-center">
				<span class="text-sm font-semibold text-gray-100">Servers</span>
				<Badge variant="secondary" class="ml-2 text-[10px]">{serversState.servers.length}</Badge>
				{#if serversState.statusRefreshing && serversState.servers.length > 0}
					<span class="ml-2 h-1.5 w-1.5 animate-pulse rounded-full bg-gray-500"></span>
				{/if}
			</div>
			<Button
				variant="outline"
				size="sm"
				class="h-6 w-6 border-red-500/50 p-0 text-red-400 hover:border-red-500 hover:bg-red-950 hover:text-gray-100"
				onclick={() => goto(`/projects/${page.params.projectid}/servers/create`)}
			>
				<Plus class="h-3.5 w-3.5" />
			</Button>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#if serversState.loading}
				<div class="divide-y divide-gray-800">
					{#each Array.from({ length: 3 }) as _, index (index)}
						<div class="flex items-start justify-between px-4 py-3">
							<div class="min-w-0 flex-1 space-y-2">
								<div class="h-3 w-28 animate-pulse rounded bg-gray-800"></div>
								<div class="h-2.5 w-36 animate-pulse rounded bg-gray-800/70"></div>
							</div>
							<div class="mt-1 ml-2 h-2 w-2 shrink-0 animate-pulse rounded-full bg-gray-800"></div>
						</div>
					{/each}
				</div>
			{/if}

			{#each serversState.servers as server (server.id)}
				<a
					class="flex w-full items-start justify-between border-b border-gray-800 px-4 py-3 text-left transition-colors duration-100 {selectedServerId ===
					server.id
						? 'bg-gray-800/60'
						: 'hover:bg-gray-800/30'}"
					href={`/projects/${page.params.projectid}/servers/${server.id}`}
					data-sveltekit-preload-data="tap"
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-gray-100">{server.name}</p>
						<p class="mt-0.5 truncate text-xs text-gray-500">
							{server.vcpu} vCPU &bull; {server.ram} &bull;
							{#if server.liveLoaded || serversState.firstStatusRefreshComplete}
								{server.ip}
							{:else}
								<span class="inline-block h-2.5 w-14 animate-pulse rounded bg-gray-800"></span>
							{/if}
						</p>
					</div>
					<span
						class="mt-1 ml-2 h-2 w-2 shrink-0 rounded-full {server.liveLoaded
							? server.status === 'running'
								? 'bg-emerald-500'
								: server.status === 'provisioning'
									? 'animate-pulse bg-blue-500'
									: server.status === 'restarting'
										? 'animate-pulse bg-amber-500'
										: 'bg-red-500'
							: 'bg-gray-600'}"
					></span>
				</a>
			{/each}

			{#if !serversState.loading && serversState.servers.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-gray-500">
					<HardDrive class="mb-3 h-6 w-6" />
					<p class="text-xs">No servers</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Main content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{@render children()}
	</div>
</div>
