<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Play, Power, PowerOff, RotateCw, Loader2 } from '@lucide/svelte';
	import type { FeatureFlags } from '$lib/feature-flags';
	import { killVm, rebootVm, startVm, stopVm } from '$lib/remote/vms.remote';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { serverTabs, type ServerTab } from './lib/server-detail';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';
	import { confirmDestructive } from '$lib/confirm.svelte';

	type ServerTabHref =
		| `/projects/${string}/servers/${string}`
		| `/projects/${string}/servers/${string}/backups`
		| `/projects/${string}/servers/${string}/console`
		| `/projects/${string}/servers/${string}/images`
		| `/projects/${string}/servers/${string}/logs`
		| `/projects/${string}/servers/${string}/networking`
		| `/projects/${string}/servers/${string}/rebuild`
		| `/projects/${string}/servers/${string}/rescue`
		| `/projects/${string}/servers/${string}/resize`
		| `/projects/${string}/servers/${string}/settings`
		| `/projects/${string}/servers/${string}/snapshots`;

	type PowerAction = 'start' | 'shutdown' | 'kill' | 'restart';

	let { data, children } = $props();
	let powerAction = $state<PowerAction | null>(null);
	const powerLoading = $derived(powerAction !== null);
	const featureFlags = $derived((data.featureFlags ?? {}) as FeatureFlags);
	const visibleServerTabs = $derived(
		serverTabs.filter((tab) => !tab.featureFlag || featureFlags[tab.featureFlag])
	);
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let serverId = $derived(selectedServer.id);
	let activeTab = $derived.by<ServerTab>(() => {
		const tab = page.url.pathname.split('/').pop();
		return visibleServerTabs.some((entry) => entry.id === tab) ? (tab as ServerTab) : 'overview';
	});

	function tabHref(tab: ServerTab): ServerTabHref {
		const base = `/projects/${page.params.projectid}/servers/${serverId}`;
		return (tab === 'overview' ? base : `${base}/${tab}`) as ServerTabHref;
	}

	const powerMessages = {
		start: { success: 'Server started', error: 'Failed to start server' },
		shutdown: { success: 'Server is shutting down', error: 'Failed to shut down server' },
		restart: { success: 'Server is restarting', error: 'Failed to restart server' },
		kill: { success: 'Server powered off', error: 'Failed to power off server' }
	} as const;

	async function power(action: PowerAction) {
		if (!selectedServer || powerLoading) return;

		if (action === 'kill') {
			const ok = await confirmDestructive({
				title: 'Force power off',
				description: `This forces ${selectedServer.name} off like pulling the plug, which can corrupt the filesystem or lose unsaved data. Use Shutdown for a clean stop.`,
				confirmLabel: 'Force power off'
			});
			if (!ok) return;
		}

		powerAction = action;

		try {
			if (action === 'start') {
				await startVm({ vmId: selectedServer.id });
			} else if (action === 'shutdown') {
				await stopVm({ vmId: selectedServer.id });
			} else if (action === 'restart') {
				await rebootVm({ vmId: selectedServer.id });
			} else {
				await killVm({ vmId: selectedServer.id });
			}
			toast.success(powerMessages[action].success);
		} catch (error) {
			toast.error(getErrorMessage(error, powerMessages[action].error));
		} finally {
			powerAction = null;
		}
	}
</script>

<div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-4">
	<div class="flex min-w-0 items-center gap-2">
		<span class="truncate text-sm font-medium text-gray-200">{selectedServer.name}</span>
		<Badge
			variant="outline"
			class="text-[10px] {!selectedServer.liveLoaded
				? 'border-gray-700 bg-gray-900/40 text-gray-400'
				: selectedServer.status === 'running'
					? 'border-emerald-800 bg-emerald-950/40 text-emerald-400'
					: selectedServer.status === 'provisioning'
						? 'border-blue-800 bg-blue-950/40 text-blue-400'
						: selectedServer.status === 'restarting'
							? 'border-amber-800 bg-amber-950/40 text-amber-400'
							: 'border-red-800 bg-red-950/40 text-red-400'}"
		>
			{!selectedServer.liveLoaded
				? 'unknown'
				: selectedServer.status === 'provisioning'
					? 'provisioning...'
					: selectedServer.status}
		</Badge>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-2.5 text-xs sm:px-3"
			aria-label="Start"
			disabled={powerLoading ||
				selectedServer.status === 'running' ||
				selectedServer.status === 'restarting' ||
				selectedServer.status === 'provisioning'}
			onclick={() => power('start')}
		>
			{#if powerAction === 'start'}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<Play class="h-3 w-3" />
			{/if}
			<span class="hidden sm:inline">Start</span>
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-2.5 text-xs sm:px-3"
			aria-label="Restart"
			disabled={powerLoading ||
				selectedServer.status === 'stopped' ||
				selectedServer.status === 'restarting' ||
				selectedServer.status === 'provisioning'}
			onclick={() => power('restart')}
		>
			{#if powerAction === 'restart'}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<RotateCw class="h-3 w-3 {selectedServer.status === 'restarting' ? 'animate-spin' : ''}" />
			{/if}
			<span class="hidden sm:inline">Restart</span>
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-2.5 text-xs sm:px-3"
			aria-label="Shutdown"
			disabled={powerLoading ||
				selectedServer.status === 'stopped' ||
				selectedServer.status === 'provisioning'}
			onclick={() => power('shutdown')}
		>
			{#if powerAction === 'shutdown'}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<Power class="h-3 w-3" />
			{/if}
			<span class="hidden sm:inline">Shutdown</span>
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 border-red-700 px-2.5 text-xs text-red-400 hover:bg-red-950 sm:px-3"
			aria-label="Kill"
			disabled={powerLoading ||
				selectedServer.status === 'stopped' ||
				selectedServer.status === 'provisioning'}
			onclick={() => power('kill')}
		>
			{#if powerAction === 'kill'}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<PowerOff class="h-3 w-3" />
			{/if}
			<span class="hidden sm:inline">Kill</span>
		</Button>
	</div>
</div>

<div class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-gray-800 px-2">
	{#each visibleServerTabs as tab (tab.id)}
		<a
			aria-current={activeTab === tab.id ? 'page' : undefined}
			class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors duration-100 {activeTab ===
			tab.id
				? 'border-b-2 border-red-500 text-gray-50'
				: 'text-gray-500 hover:text-gray-300'}"
			href={resolve(tabHref(tab.id))}
			data-sveltekit-preload-data="hover"
		>
			<tab.icon class="h-3 w-3" />
			{tab.label}
		</a>
	{/each}
</div>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
	{@render children()}
</div>
