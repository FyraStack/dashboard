<script lang="ts">
	import type { PageProps } from './$types';
	import { untrack } from 'svelte';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let nameValue = $state(untrack(() => data.server.name));
	let nameServerId = $state(untrack(() => data.serverId));

	$effect(() => {
		if (selectedServer.id !== nameServerId) {
			nameServerId = selectedServer.id;
			nameValue = selectedServer.name;
		}
	});
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-sm font-semibold text-gray-100">Server Settings</h2>
		<p class="mt-1 text-xs text-gray-500">Manage basic settings for {selectedServer.name}.</p>
	</div>
	<div class="space-y-2">
		<Label for="server-name-input">Server Name</Label><Input
			id="server-name-input"
			bind:value={nameValue}
		/>
	</div>
	<div class="space-y-2">
		<Label for="server-id-input">Server ID</Label><Input
			id="server-id-input"
			value={selectedServer.id}
			disabled
			class="font-mono"
		/>
	</div>
	<div class="flex gap-2">
		<Button size="sm">Save Changes</Button><Button
			variant="outline"
			size="sm"
			class="border-red-700 text-red-400 hover:bg-red-950">Delete Server</Button
		>
	</div>
</div>
