<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import VmConsole from '../lib/vm-console.svelte';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
</script>

<div class="flex min-h-0 flex-1 flex-col">
	{#key selectedServer.id}
		<VmConsole vmId={selectedServer.id} serverName={selectedServer.name} />
	{/key}
</div>
