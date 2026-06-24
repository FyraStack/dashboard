<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import ComingSoon from '$lib/components/coming-soon.svelte';
	import { Camera, Trash2 } from '@lucide/svelte';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let snapshots = $state([
		{ id: 'snap-001', name: 'pre-deploy-v2.4', size: '4.2 GB', date: '2026-04-03' },
		{ id: 'snap-002', name: 'weekly-backup', size: '3.8 GB', date: '2026-03-29' }
	]);
</script>

<div class="overflow-auto">
	<div class="flex items-center justify-between px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Snapshots</span>
		<div class="flex items-center gap-2">
			<ComingSoon />
			<Button variant="outline" size="sm" disabled class="h-7 gap-1.5 px-3 text-xs"
				><Camera class="h-3 w-3" />Take Snapshot</Button
			>
		</div>
	</div>
	<div class="px-5 pb-3">
		<div class="border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-500">
			Preview — snapshots aren't available yet. The entries below are sample data.
		</div>
	</div>
	<div class="divide-y divide-gray-800/50">
		{#each snapshots as snap (snap.id)}
			<div class="flex items-center justify-between px-5 py-3">
				<div>
					<p class="text-sm font-medium text-gray-100">{snap.name}</p>
					<p class="mt-0.5 text-xs text-gray-400">{snap.date} • {snap.size}</p>
				</div>
				<Button variant="ghost" size="sm" disabled class="h-7 w-7 p-0 text-red-400"
					><Trash2 class="h-3 w-3" /></Button
				>
			</div>
		{/each}
	</div>
</div>
