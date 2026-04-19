<script lang="ts">
	import { goto } from '$app/navigation';
	import { Plus, Server } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex h-full flex-col items-center justify-center text-fyra-gray-500">
	<div class="flex flex-col items-center text-center">
		<div
			class="flex w-80 flex-col items-center gap-4 border border-dashed border-fyra-gray-700 p-8"
		>
			<Server class="size-6 text-fyra-gray-500" />
			<div>
				<p class="text-sm font-medium text-fyra-gray-300">No servers deployed</p>
				<p class="mt-1 text-xs text-fyra-gray-500">
					This project has no servers yet. Deploy your first VPS to get started.
				</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				class="mt-2 gap-1.5 border-fyra-gray-700 text-fyra-gray-300 hover:border-fyra-gray-600 hover:bg-fyra-gray-800 hover:text-fyra-gray-100"
				onclick={() => goto('/servers/create')}
			>
				<Plus class="size-3.5" />
				New Server
			</Button>
		</div>
	</div>
</div>
