<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Plus from '~icons/lucide/plus';
	import Server from '~icons/nucleo/server';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { serversState } from '$lib/state/servers.svelte';

	const shouldShowEmptyState = $derived(
		!serversState.loading &&
			serversState.firstStatusRefreshComplete &&
			serversState.servers.length === 0
	);
</script>

{#if shouldShowEmptyState}
	<div class="flex h-full flex-col items-center justify-center text-muted-foreground">
		<div class="flex w-full flex-col items-center px-4 text-center">
			<div
				class="flex w-full max-w-80 flex-col items-center gap-4 border border-dashed border-border p-6 sm:p-8"
			>
				<Server class="size-6 text-muted-foreground" />
				<div>
					<p class="text-base font-medium text-muted-foreground sm:text-sm">No servers deployed</p>
					<p class="mt-1 text-sm text-muted-foreground sm:text-xs">
						This project has no servers yet. Deploy your first VPS to get started.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					class="mt-2 h-10 gap-1.5 border-border text-sm text-muted-foreground hover:border-ring hover:bg-muted hover:text-foreground sm:h-8 sm:text-xs"
					onclick={() => goto(`/projects/${page.params.projectid}/servers/create`)}
				>
					<Plus class="size-3.5" />
					New Server
				</Button>
			</div>
		</div>
	</div>
{:else}
	<div class="flex h-full flex-col" aria-busy="true" aria-label="Loading server">
		<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
			<Skeleton class="h-3.5 w-32" />
			<Skeleton class="h-4 w-16 rounded-full" />
		</div>
		<div class="flex-1 space-y-4 p-5">
			<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{#each Array.from({ length: 4 }) as _, index (index)}
					<div class="space-y-2 border border-border p-4">
						<Skeleton class="h-2.5 w-16" />
						<Skeleton class="h-5 w-24" />
					</div>
				{/each}
			</div>
			<Skeleton class="h-40 w-full" />
		</div>
	</div>
{/if}
