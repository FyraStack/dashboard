<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import Terminal from '~icons/nucleo/terminal';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
</script>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center bg-background p-8 text-center">
	<Terminal class="mb-3 h-8 w-8 text-muted-foreground" />
	<p class="text-sm text-muted-foreground">Web console isn't available yet</p>
	<p class="mt-1 max-w-xs text-xs text-muted-foreground">
		In-browser console access for {selectedServer.name} is coming soon.
	</p>
</div>
