<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-sm font-semibold text-foreground">Rescue Mode</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Boot {selectedServer.name} into a temporary rescue environment.
		</p>
	</div>
	<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
		Rescue mode isn't available yet.
	</p>
	<div class="flex items-center justify-between border border-border p-4">
		<div>
			<p class="text-sm font-medium text-foreground">Enable rescue mode</p>
			<p class="mt-1 text-xs text-muted-foreground">Requires a restart to apply.</p>
		</div>
		<Switch checked={false} disabled />
	</div>
	<Button
		variant="outline"
		disabled
		class="border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
		>Apply Rescue Mode</Button
	>
</div>
