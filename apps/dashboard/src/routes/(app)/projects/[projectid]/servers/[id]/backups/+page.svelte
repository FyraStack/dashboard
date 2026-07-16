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
		<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Backups</span
		>
	</div>
	<div class="px-5 pb-3">
		<div class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
			Preview — backups aren't available yet. The entries below are sample data.
		</div>
	</div>
	<div class="divide-y divide-border/50">
		{#each backups as backup (backup.id)}
			<div class="flex items-center justify-between px-5 py-3">
				<div>
					<p class="text-sm font-medium text-foreground">{backup.date}</p>
					<p class="mt-0.5 text-xs text-muted-foreground">{backup.size}</p>
				</div>
				<Badge
					variant="outline"
					class="border-emerald-300 bg-emerald-100 text-[10px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
					>{backup.status}</Badge
				>
			</div>
		{/each}
	</div>
</div>
