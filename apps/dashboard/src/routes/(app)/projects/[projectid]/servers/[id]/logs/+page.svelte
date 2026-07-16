<script lang="ts">
	import type { PageProps } from './$types';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { AlertTriangle, Search, Trash2, X } from '@lucide/svelte';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let logSearch = $state('');
	let logSevFilter = $state<string | null>(null);
	let logSourceFilter = $state<string | null>(null);
	const sevColors: Record<string, string> = {
		info: 'text-blue-400',
		warn: 'text-amber-400',
		error: 'text-red-400',
		debug: 'text-muted-foreground'
	};
	const currentLogs = $derived([
		{
			id: 1,
			timestamp: '2026-04-27 05:10:18',
			severity: 'info',
			source: 'systemd',
			message: `boot completed for ${selectedServer.name}`
		},
		{
			id: 2,
			timestamp: '2026-04-27 05:10:20',
			severity: 'info',
			source: 'agent',
			message: 'guest agent heartbeat ok'
		},
		{
			id: 3,
			timestamp: '2026-04-27 05:11:02',
			severity: 'debug',
			source: 'network',
			message: `primary endpoint ${selectedServer.ip}`
		},
		{
			id: 4,
			timestamp: '2026-04-27 05:12:45',
			severity: selectedServer.agentConnected ? 'info' : 'warn',
			source: 'app',
			message: selectedServer.agentConnected ? 'control plane connected' : 'guest agent unreachable'
		}
	]);
	let filteredLogs = $derived.by(() => {
		let result = currentLogs;
		if (logSevFilter) result = result.filter((log) => log.severity === logSevFilter);
		if (logSourceFilter) result = result.filter((log) => log.source === logSourceFilter);
		if (logSearch.trim()) {
			const query = logSearch.toLowerCase();
			result = result.filter(
				(log) =>
					log.message.toLowerCase().includes(query) || log.source.toLowerCase().includes(query)
			);
		}
		return result;
	});
	let hasLogFilters = $derived(
		logSevFilter !== null || logSourceFilter !== null || logSearch.trim() !== ''
	);
	function clearLogFilters() {
		logSevFilter = null;
		logSourceFilter = null;
		logSearch = '';
	}
</script>

<div class="flex h-8 shrink-0 items-center justify-between border-b border-border px-4">
	<div class="flex items-center gap-2">
		<span class="text-xs font-medium text-muted-foreground">{selectedServer.name}</span>
		{#if hasLogFilters}
			<span class="text-[9px] text-muted-foreground"
				>{filteredLogs.length}/{currentLogs.length}</span
			>
			{#if logSevFilter}<button
					aria-label="Clear severity filter"
					onclick={() => (logSevFilter = null)}
					><Badge
						variant="outline"
						class="cursor-pointer gap-1 text-[8px] {sevColors[logSevFilter]}"
						>{logSevFilter.toUpperCase()}<X class="h-2 w-2" /></Badge
					></button
				>{/if}
			{#if logSourceFilter}<button
					aria-label="Clear source filter"
					onclick={() => (logSourceFilter = null)}
					><Badge variant="secondary" class="cursor-pointer gap-1 text-[8px]"
						>{logSourceFilter}<X class="h-2 w-2" /></Badge
					></button
				>{/if}
		{/if}
	</div>
	<div class="flex items-center gap-1.5">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground"
			/><input
				aria-label="Search logs"
				bind:value={logSearch}
				placeholder="Search..."
				class="h-6 w-36 border border-border bg-muted pr-2 pl-6 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
			/>
		</div>
		{#if hasLogFilters}<button
				class="text-[9px] text-red-400 hover:text-red-300"
				onclick={clearLogFilters}>Clear</button
			>{/if}
		<Button
			aria-label="Clear logs"
			variant="ghost"
			size="sm"
			class="h-6 w-6 p-0 text-red-400"
			disabled><Trash2 class="h-2.5 w-2.5" /></Button
		>
	</div>
</div>
<div
	class="shrink-0 border-b border-border bg-background/40 px-4 py-1 text-[10px] text-muted-foreground"
>
	Sample log data — live log streaming isn't available yet.
</div>
<div class="min-h-0 flex-1 overflow-auto bg-background font-mono text-[11px] leading-relaxed">
	{#if selectedServer.status !== 'running'}
		<div class="flex h-full flex-col items-center justify-center gap-3">
			<AlertTriangle class="h-10 w-10 text-amber-500/60" />
			<div class="text-center">
				<p class="text-base font-medium text-foreground">Server not running</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Start the server to connect to the guest agent and stream logs.
				</p>
			</div>
		</div>
	{:else if !selectedServer.agentConnected}
		<div class="flex h-full flex-col items-center justify-center gap-3">
			<AlertTriangle class="h-10 w-10 text-red-400/60" />
			<div class="text-center">
				<p class="text-base font-medium text-foreground">Guest agent unreachable</p>
				<p class="mt-1 max-w-sm text-xs text-muted-foreground">
					The server is running but the guest agent is not responding.
				</p>
			</div>
		</div>
	{:else}
		{#each filteredLogs as entry (entry.id)}<div
				class="flex items-baseline gap-0 px-4 py-px leading-[1.6] hover:bg-muted/20"
			>
				<span class="w-[148px] shrink-0 text-muted-foreground">{entry.timestamp}</span><button
					class="w-[42px] shrink-0 cursor-pointer text-left font-semibold uppercase {sevColors[
						entry.severity
					]} {logSevFilter === entry.severity ? 'underline' : ''}"
					onclick={() => (logSevFilter = logSevFilter === entry.severity ? null : entry.severity)}
					>{entry.severity.slice(0, 4)}</button
				><button
					class="w-[72px] shrink-0 cursor-pointer text-left text-muted-foreground hover:text-muted-foreground {logSourceFilter ===
					entry.source
						? 'text-foreground'
						: ''}"
					onclick={() => (logSourceFilter = logSourceFilter === entry.source ? null : entry.source)}
					>{entry.source}</button
				><span class="text-muted-foreground">{entry.message}</span>
			</div>{/each}
	{/if}
</div>
