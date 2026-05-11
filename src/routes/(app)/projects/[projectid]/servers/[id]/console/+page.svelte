<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));

	const terminalLines = [
		{ type: 'prompt' as const, text: 'ls /var/log' },
		{ type: 'output' as const, text: 'www.log  gamer.log  uwaa.log  fyra.log  chicago.log' },
		{ type: 'cursor' as const, text: '' }
	];
</script>

<div
	class="min-h-0 flex-1 overflow-auto bg-gray-950 p-5 font-mono text-sm leading-relaxed text-gray-300"
>
	{#if selectedServer.status === 'running'}
		{#each terminalLines as line (line.type + line.text)}
			{#if line.type === 'prompt'}
				<div>
					<span class="text-gray-500">user@{selectedServer.name}~:</span>
					{line.text}
				</div>
			{:else if line.type === 'output'}
				<div class="text-gray-400">{line.text}</div>
			{:else}
				<div>
					<span class="text-gray-500">user@{selectedServer.name}~:</span>
					<span class="inline-block h-4 w-1.5 animate-pulse bg-gray-400"></span>
				</div>
			{/if}
		{/each}
	{:else}
		<div class="text-gray-600">Server is offline. Start the server to connect.</div>
	{/if}
</div>
