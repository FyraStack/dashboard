<script lang="ts">
	import { createServerPath } from 'stack-shared/routes';
	import { untrack } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { listVmStatuses } from '#lib/remote/vms.remote.js';
	import { primaryAddress } from '#lib/server-info.js';
	import {
		applyLiveStatuses,
		listedServers,
		serversState,
		syncServers
	} from '#lib/state/servers.svelte.js';
	import { describeServerStatus, isPendingStatus, statusDotClass } from '#lib/vm-status.js';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDown from '~icons/lucide/chevron-down';
	import Plus from '~icons/lucide/plus';
	import HardDrive from '~icons/nucleo/hard-drive';

	let { data, children } = $props();

	function hasPendingServers(): boolean {
		return serversState.servers.some((server) => isPendingStatus(server.status));
	}

	const REFRESH_INTERVAL_MS = 30_000;
	const PENDING_REFRESH_INTERVAL_MS = 3000;
	const projectId = $derived(data.projectId);
	const currentServers = $derived(listedServers(projectId, data.servers));

	$effect(() => {
		const incoming = data.servers;
		const incomingProjectId = projectId;
		untrack(() => syncServers(incomingProjectId, incoming));
	});

	$effect(() => {
		const pollingProjectId = projectId;
		const { refreshVersion } = serversState;

		let cancelled = false;
		let refreshing = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;

		async function refreshStatuses() {
			if (cancelled || refreshing || document.visibilityState !== 'visible') {
				return;
			}
			if (serversState.servers.length === 0) {
				return;
			}
			refreshing = true;
			serversState.statusRefreshing = true;
			const requestedServerIds = new Set(serversState.servers.map((server) => server.id));

			try {
				const statuses = await loadStatuses();
				if (statuses && !cancelled && refreshVersion === serversState.refreshVersion) {
					applyLiveStatuses(statuses, requestedServerIds);
				}
			} finally {
				finishRefresh();
			}
		}

		async function loadStatuses() {
			try {
				const statusesQuery = listVmStatuses({ projectId: pollingProjectId });
				await statusesQuery.refresh();
				return await statusesQuery;
			} catch {
				return null;
			}
		}

		function finishRefresh() {
			refreshing = false;
			if (cancelled || refreshVersion !== serversState.refreshVersion) {
				return;
			}
			serversState.statusRefreshing = false;
			serversState.firstStatusRefreshComplete = true;
			if (document.visibilityState === 'visible') {
				timeout = setTimeout(
					refreshStatuses,
					hasPendingServers() ? PENDING_REFRESH_INTERVAL_MS : REFRESH_INTERVAL_MS
				);
			}
		}

		function handleVisibilityChange() {
			clearTimeout(timeout);
			refreshStatuses();
		}

		untrack(() => {
			refreshStatuses();
		});
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			cancelled = true;
			clearTimeout(timeout);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			serversState.statusRefreshing = false;
		};
	});

	$effect(() => {
		if (currentServers.length === 0 || currentPath !== serversPath) {
			return;
		}
		goto(`${serversPath}/${currentServers[0].id}`, { replace: true });
	});

	const currentPath = $derived(page.url.pathname);
	const serversPath = $derived(`/projects/${projectId}/servers`);
	const isCreatePage = $derived(currentPath === `${serversPath}/create`);
	const isServersIndex = $derived(currentPath === serversPath);
	let mobileListOpen = $state(false);
	const listOpen = $derived(mobileListOpen || isServersIndex);

	afterNavigate(({ from, to }) => {
		if (from?.url.pathname !== to?.url.pathname) {
			mobileListOpen = false;
		}
	});
	const selectedServerId = $derived.by(() => {
		if (isCreatePage || !currentPath.startsWith(`${serversPath}/`)) {
			return null;
		}
		return currentPath.split('/').pop();
	});
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
					>{currentServers.length}</Badge
				>
				{#if serversState.statusRefreshing && currentServers.length > 0}
					<span
						class="ml-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground"
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
					aria-label="Create server"
					class="relative h-8 w-8 border-red-500/50 p-0 text-red-700 hover:border-red-500 hover:bg-red-100 hover:text-foreground lg:h-6 lg:w-6 dark:text-red-400 dark:hover:bg-red-950"
					onclick={() => goto(createServerPath(projectId))}
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
			{#each currentServers as server (server.id)}
				{@const status = describeServerStatus(server.status, server.liveLoaded)}
				<a
					class="flex w-full items-start justify-between border-b border-border px-4 py-3 text-left transition-colors duration-100 {selectedServerId ===
					server.id
						? 'bg-muted/60'
						: 'hover:bg-muted/30'}"
					href={`/projects/${projectId}/servers/${server.id}`}
					data-sveltekit-preload-data="tap"
				>
					<div class="min-w-0">
						<p class="truncate text-base font-semibold text-foreground lg:text-sm">{server.name}</p>
						<p class="mt-0.5 truncate text-sm text-muted-foreground lg:text-xs">
							{server.vcpu}
							vCPU &bull; {server.ram} &bull;
							{#if server.liveLoaded || serversState.firstStatusRefreshComplete}
								{primaryAddress(server) ?? '-'}
							{:else}
								<span class="inline-block h-2.5 w-14 animate-pulse rounded bg-muted"></span>
							{/if}
						</p>
					</div>
					<span
						role="img"
						aria-label={`Status: ${status.label}`}
						title={status.label}
						class="mt-1 ml-2 h-2 w-2 shrink-0 rounded-full {statusDotClass[
							status.tone
						]} {status.pending ? 'animate-pulse' : ''}"
					></span>
				</a>
			{/each}

			{#if currentServers.length === 0}
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
