<script lang="ts">
	import { vpsServerTabFeatureFlags } from 'stack-shared/feature-flags';
	import { toast } from 'svelte-sonner';
	import type { IconComponent } from '#lib';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { confirmDestructive } from '#lib/confirm.svelte.js';
	import { killVm, rebootVm, startVm, stopVm } from '#lib/remote/vms.remote.js';
	import { getServerWithFallback, requestServerStatusRefresh } from '#lib/state/servers.svelte.js';
	import { getErrorMessage } from '#lib/utils.js';
	import {
		canPowerOff,
		canPowerOn,
		canReboot,
		describeServerStatus,
		statusBadgeClass
	} from '#lib/vm-status.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowUpDown from '~icons/lucide/arrow-up-down';
	import Loader2 from '~icons/lucide/loader-2';
	import Activity from '~icons/nucleo/activity';
	import Camera from '~icons/nucleo/camera';
	import Clock from '~icons/nucleo/clock';
	import Disc from '~icons/nucleo/disc';
	import FileText from '~icons/nucleo/file-text';
	import Globe from '~icons/nucleo/globe';
	import Play from '~icons/nucleo/play';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Settings from '~icons/nucleo/settings';
	import Terminal from '~icons/nucleo/terminal';
	import { provideServer } from './lib/server-context';

	type ServerTab = 'overview' | keyof typeof vpsServerTabFeatureFlags;

	const serverTabs: { icon: IconComponent; id: ServerTab; label: string }[] = [
		{ id: 'overview', label: 'Overview', icon: Activity },
		{ id: 'console', label: 'Console', icon: Terminal },
		{ id: 'logs', label: 'Logs', icon: FileText },
		{ id: 'networking', label: 'Networking', icon: Globe },
		{ id: 'images', label: 'Images', icon: Disc },
		{ id: 'snapshots', label: 'Snapshots', icon: Camera },
		{ id: 'backups', label: 'Backups', icon: Clock },
		{ id: 'rebuild', label: 'Rebuild', icon: RotateCw },
		{ id: 'resize', label: 'Resize', icon: ArrowUpDown },
		{ id: 'rescue', label: 'Rescue', icon: Terminal },
		{ id: 'settings', label: 'Settings', icon: Settings }
	];

	type PowerAction = 'start' | 'shutdown' | 'kill' | 'restart';

	let { data, children } = $props();
	let powerAction = $state<PowerAction | null>(null);
	const powerLoading = $derived(powerAction !== null);
	const visibleServerTabs = $derived(
		serverTabs.filter(
			(tab) => tab.id === 'overview' || data.featureFlags[vpsServerTabFeatureFlags[tab.id]]
		)
	);
	const selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	const status = $derived(describeServerStatus(selectedServer.status, selectedServer.liveLoaded));
	provideServer(() => selectedServer);
	let activeTab = $derived.by<ServerTab>(() => {
		const segment = page.url.pathname.split('/').pop();
		return visibleServerTabs.find((entry) => entry.id === segment)?.id ?? 'overview';
	});

	function tabHref(tab: ServerTab) {
		const base = `projects/${page.params.projectid}/servers/${selectedServer.id}` as const;
		return tab === 'overview' ? base : (`${base}/${tab}` as const);
	}

	const powerMessages = {
		start: { success: 'Server started', error: 'Failed to start server' },
		shutdown: { success: 'Server is shutting down', error: 'Failed to shut down server' },
		restart: { success: 'Server is restarting', error: 'Failed to restart server' },
		kill: { success: 'Server powered off', error: 'Failed to power off server' }
	} as const;

	async function power(action: PowerAction) {
		if (powerLoading) {
			return;
		}

		if (action === 'kill') {
			const ok = await confirmDestructive({
				title: 'Force power off',
				description: `This forces ${selectedServer.name} off like pulling the plug, which can corrupt the filesystem or lose unsaved data. Use Shutdown for a clean stop.`,
				confirmLabel: 'Force power off'
			});
			if (!ok) {
				return;
			}
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
			requestServerStatusRefresh();
			toast.success(powerMessages[action].success);
		} catch (error) {
			toast.error(getErrorMessage(error, powerMessages[action].error));
		} finally {
			powerAction = null;
		}
	}
</script>

<div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
	<div class="flex min-w-0 items-center gap-2">
		<span class="truncate text-sm font-medium text-foreground">{selectedServer.name}</span>
		<Badge variant="outline" class="text-[10px] {statusBadgeClass[status.tone]}">
			{status.label}
		</Badge>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-2.5 text-xs sm:px-3"
			aria-label="Start"
			disabled={powerLoading || !canPowerOn(selectedServer.status)}
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
			disabled={powerLoading || !canReboot(selectedServer.status)}
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
			disabled={powerLoading || !canPowerOff(selectedServer.status)}
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
			class="h-7 gap-1.5 border-red-300 px-2.5 text-xs text-red-700 hover:bg-red-100 sm:px-3 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
			aria-label="Kill"
			disabled={powerLoading || !canPowerOff(selectedServer.status)}
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

<div class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border px-2">
	{#each visibleServerTabs as tab (tab.id)}
		<a
			aria-current={activeTab === tab.id ? 'page' : undefined}
			class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors duration-100 {activeTab ===
			tab.id
				? 'border-b-2 border-red-500 text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
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
