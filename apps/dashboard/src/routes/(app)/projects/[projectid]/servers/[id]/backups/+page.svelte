<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Badge } from '$lib/components/ui/badge';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	const backups = [
		{ id: 'bk-001', date: '2026-04-05 03:00', size: '3.9 GB', status: 'completed' },
		{ id: 'bk-002', date: '2026-04-04 03:00', size: '3.9 GB', status: 'completed' },
		{ id: 'bk-003', date: '2026-04-03 03:00', size: '3.8 GB', status: 'completed' }
	];
</script>

<div class="overflow-auto">
	<div class="px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Backups</span>
	</div>
	<div class="px-5 pb-3">
		<div class="border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-500">
			Preview — backups aren't available yet. The entries below are sample data.
		</div>
	</div>
	<div class="divide-y divide-gray-800/50">
		{#each backups as backup (backup.id)}
			<div class="flex items-center justify-between px-5 py-3">
				<div>
					<p class="text-sm font-medium text-gray-100">{backup.date}</p>
					<p class="mt-0.5 text-xs text-gray-400">{backup.size}</p>
				</div>
				<Badge
					variant="outline"
					class="border-emerald-800 bg-emerald-950/40 text-[10px] text-emerald-400"
					>{backup.status}</Badge
				>
			</div>
		{/each}
	</div>
</div>
