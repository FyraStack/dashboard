<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ChevronDown from '~icons/lucide/chevron-down';
	import Plus from '~icons/lucide/plus';
	import HardDrive from '~icons/nucleo/hard-drive';
	import { listVmStatuses } from '$lib/remote/vms.remote';
	import { clientTimingLog, runQuery } from '$lib/utils';
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

	function statusLabel(s: { liveLoaded?: boolean; status: string }): string {
		if (s.status === 'deleting') return 'Deleting';
		if (!s.liveLoaded) return 'Unknown';
		if (s.status === 'running') return 'Running';
		if (s.status === 'provisioning') return 'Provisioning';
		if (s.status === 'restarting') return 'Restarting';
		if (s.status === 'unknown') return 'Unknown';
		return 'Stopped';
	}

	const REFRESH_INTERVAL_MS = 15000;

	const initialServers = $derived(data.servers ?? []);
	let projectId = $derived(data.projectId ?? null);
	let refreshTimeout: number | null = null;

	function scheduleRefreshStatuses() {
		clientTimingLog('vm.status.scheduleRefreshStatuses', {
			'project.id': projectId ?? undefined,
			'vm.status.delay_ms': 500,
			'vm.status.had_pending_timeout': Boolean(refreshTimeout)
		});
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
		const started = performance.now();
		clientTimingLog('vm.status.refresh.start', {
			'project.id': projectId,
			'vm.status.server_count': serversState.servers.length
		});
		serversState.statusRefreshing = true;

		try {
			clientTimingLog('vm.status.refresh.remote.start', { 'project.id': projectId });
			const statuses = await runQuery(listVmStatuses({ projectId }), 'listVmStatuses');
			clientTimingLog('vm.status.refresh.remote.end', {
				'project.id': projectId,
				'vm.status.count': statuses.length,
				duration_ms: Math.round((performance.now() - started) * 100) / 100
			});
			const byId = new Map(statuses.map((server) => [server.id, server]));

			untrack(() => {
				serversState.servers = sortServers(serversState.servers)
					.filter((server) => server.status !== 'deleting' || byId.has(server.id))
					.map((server) => {
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
								next.status === 'deleting'
									? 'deleting'
									: next.status === 'running'
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
			clientTimingLog('vm.status.refresh.error', {
				'project.id': projectId,
				duration_ms: Math.round((performance.now() - started) * 100) / 100
			});
		} finally {
			serversState.statusRefreshing = false;
			serversState.firstStatusRefreshComplete = true;
			clientTimingLog('vm.status.refresh.end', {
				'project.id': projectId,
				duration_ms: Math.round((performance.now() - started) * 100) / 100
			});
		}
	}

	$effect(() => {
		if (!projectId) return;
		clientTimingLog('vm.status.polling.effect.start', {
			'project.id': projectId,
			'vm.status.initial_count': initialServers.length
		});

		let interval: number | null = null;

		function startPolling() {
			if (interval !== null) return;
			clientTimingLog('vm.status.polling.start', {
				'project.id': projectId,
				'vm.status.interval_ms': REFRESH_INTERVAL_MS
			});
			interval = window.setInterval(scheduleRefreshStatuses, REFRESH_INTERVAL_MS);
		}

		function stopPolling() {
			if (interval === null) return;
			clientTimingLog('vm.status.polling.stop', { 'project.id': projectId });
			window.clearInterval(interval);
			interval = null;
		}

		function handleVisibilityChange() {
			clientTimingLog('vm.status.visibilityChange', {
				'project.id': projectId,
				'document.visibility_state': document.visibilityState
			});
			if (document.visibilityState === 'visible') {
				scheduleRefreshStatuses();
				startPolling();
			} else {
				stopPolling();
				cancelScheduledRefreshStatuses();
			}
		}

		untrack(() => {
			refreshStatuses();
		});
		startPolling();
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			cancelScheduledRefreshStatuses();
			stopPolling();
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
	const isServersIndex = $derived(currentPath === serversPath);
	let mobileListOpen = $state(false);
	const listOpen = $derived(mobileListOpen || isServersIndex);

	$effect(() => {
		currentPath;
		mobileListOpen = false;
	});
	const selectedServerId = $derived(
		isCreatePage
			? null
			: currentPath.startsWith(`${serversPath}/`)
				? currentPath.split('/').pop()
				: null
	);
</script>

<div class="flex h-full w-full flex-col overflow-hidden lg:flex-row">
	<div
		class="flex w-full shrink-0 flex-col border-b border-border lg:max-h-none lg:w-64 lg:border-r lg:border-b-0 {listOpen
			? 'max-h-[38dvh]'
			: ''}"
	>
		<div
			class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 lg:h-10"
		>
			<div class="flex min-w-0 items-center">
				<span class="text-base font-semibold text-foreground lg:text-sm">Servers</span>
				<Badge variant="secondary" class="ml-2 text-xs lg:text-[10px]"
					>{serversState.servers.length}</Badge
				>
				{#if serversState.statusRefreshing && serversState.servers.length > 0}
					<span class="ml-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground"
					></span>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-1">
				{#if !isServersIndex}
					<button
						type="button"
						class="relative flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground lg:hidden"
						aria-expanded={listOpen}
						aria-label={listOpen ? 'Hide server list' : 'Show server list'}
						onclick={() => (mobileListOpen = !mobileListOpen)}
					>
						<span
							class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
							aria-hidden="true"
						></span>
						<ChevronDown class="h-4 w-4 transition-transform {listOpen ? 'rotate-180' : ''}" />
					</button>
				{/if}
				<Button
					variant="outline"
					size="sm"
					class="relative h-8 w-8 border-red-500/50 p-0 text-red-700 hover:border-red-500 hover:bg-red-100 hover:text-foreground lg:h-6 lg:w-6 dark:text-red-400 dark:hover:bg-red-950"
					onclick={() => goto(`/projects/${page.params.projectid}/servers/create`)}
				>
					<span
						class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
						aria-hidden="true"
					></span>
					<Plus class="h-4 w-4 lg:h-3.5 lg:w-3.5" />
				</Button>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto {listOpen ? '' : 'hidden'} lg:block">
			{#if serversState.loading}
				<div class="divide-y divide-border">
					{#each Array.from({ length: 3 }) as _, index (index)}
						<div class="flex items-start justify-between px-4 py-3">
							<div class="min-w-0 flex-1 space-y-2">
								<div class="h-3 w-28 animate-pulse rounded bg-muted"></div>
								<div class="h-2.5 w-36 animate-pulse rounded bg-muted/70"></div>
							</div>
							<div class="mt-1 ml-2 h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted"></div>
						</div>
					{/each}
				</div>
			{/if}

			{#each serversState.servers as server (server.id)}
				<a
					class="flex w-full items-start justify-between border-b border-border px-4 py-3 text-left transition-colors duration-100 {selectedServerId ===
					server.id
						? 'bg-muted/60'
						: 'hover:bg-muted/30'}"
					href={`/projects/${page.params.projectid}/servers/${server.id}`}
					data-sveltekit-preload-data="tap"
				>
					<div class="min-w-0">
						<p class="truncate text-base font-semibold text-foreground lg:text-sm">{server.name}</p>
						<p class="mt-0.5 truncate text-sm text-muted-foreground lg:text-xs">
							{server.vcpu} vCPU &bull; {server.ram} &bull;
							{#if server.liveLoaded || serversState.firstStatusRefreshComplete}
								{server.ip}
							{:else}
								<span class="inline-block h-2.5 w-14 animate-pulse rounded bg-muted"></span>
							{/if}
						</p>
					</div>
					<span
						role="img"
						aria-label={`Status: ${statusLabel(server)}`}
						title={statusLabel(server)}
						class="mt-1 ml-2 h-2 w-2 shrink-0 rounded-full {server.status === 'deleting'
							? 'animate-pulse bg-red-500'
							: server.liveLoaded
								? server.status === 'running'
									? 'bg-emerald-500'
									: server.status === 'provisioning'
										? 'animate-pulse bg-blue-500'
										: server.status === 'restarting'
											? 'animate-pulse bg-amber-500'
											: server.status === 'unknown'
												? 'bg-muted-foreground'
												: 'bg-red-500'
								: 'bg-muted-foreground'}"
					></span>
				</a>
			{/each}

			{#if !serversState.loading && serversState.servers.length === 0}
				<div class="flex flex-col items-center justify-center py-8 text-muted-foreground lg:py-16">
					<HardDrive class="mb-3 h-6 w-6" />
					<p class="text-sm lg:text-xs">No servers</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="flex flex-1 flex-col overflow-hidden">
		{@render children()}
	</div>
</div>
