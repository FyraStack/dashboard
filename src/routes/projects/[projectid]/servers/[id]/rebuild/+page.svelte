<script lang="ts">
	import type { PageProps } from './$types';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let rebuildOs = $state('Ultramarine Linux 40');
	const osOptions = [
		'Ultramarine Linux 40',
		'Fedora 42',
		'Debian 12',
		'Ubuntu 24.04 LTS',
		'Alpine 3.20'
	];
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-sm font-semibold text-gray-100">Rebuild Server</h2>
		<p class="mt-1 text-xs text-gray-500">
			Reinstall {selectedServer.name} with a fresh operating system.
		</p>
	</div>
	<div class="space-y-2">
		<Label for="rebuild-os-select">Operating System</Label><select
			id="rebuild-os-select"
			bind:value={rebuildOs}
			class="h-9 w-full border border-gray-700 bg-gray-900 px-3 text-sm text-gray-100"
			>{#each osOptions as os (os)}<option>{os}</option>{/each}</select
		>
	</div>
	<div class="space-y-2">
		<Label for="rebuild-confirm-input">Type server ID to confirm</Label><Input
			id="rebuild-confirm-input"
			placeholder={selectedServer.id}
			class="font-mono"
		/>
	</div>
	<Button variant="outline" class="border-red-700 text-red-400 hover:bg-red-950"
		>Rebuild Server</Button
	>
</div>
