<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-sm font-semibold text-gray-100">Rescue Mode</h2>
		<p class="mt-1 text-xs text-gray-500">
			Boot {selectedServer.name} into a temporary rescue environment.
		</p>
	</div>
	<p class="border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs text-gray-500">
		Rescue mode isn't available yet.
	</p>
	<div class="flex items-center justify-between border border-gray-800 p-4">
		<div>
			<p class="text-sm font-medium text-gray-100">Enable rescue mode</p>
			<p class="mt-1 text-xs text-gray-500">Requires a restart to apply.</p>
		</div>
		<Switch checked={false} disabled />
	</div>
	<Button variant="outline" disabled class="border-amber-700 text-amber-400 hover:bg-amber-950"
		>Apply Rescue Mode</Button
	>
</div>
