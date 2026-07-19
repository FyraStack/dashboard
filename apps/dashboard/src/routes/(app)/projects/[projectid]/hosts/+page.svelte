<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import type { ManagedHost } from '$lib/remote/managed-hosts.remote';
	import Plus from '~icons/lucide/plus';
	import Server from '~icons/nucleo/server';

	type PageData = {
		hosts?: ManagedHost[];
	};

	let { data }: { data: PageData } = $props();
	let hosts = $derived(data.hosts ?? []);
	let onlineHosts = $derived(hosts.filter((host) => host.connectionState === 'online').length);
	let offlineHosts = $derived(hosts.filter((host) => host.connectionState === 'offline').length);
	let unknownHosts = $derived(hosts.filter((host) => host.connectionState === 'unknown').length);
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
	<div class="border-b border-border px-5 py-4">
		<div class="flex items-center gap-2">
			<Server class="size-4 text-muted-foreground" />
			<h1 class="text-base font-semibold text-foreground">Managed Hosts</h1>
		</div>
		<p class="mt-1 text-xs text-muted-foreground">
			Select a host from the list to inspect capabilities and dispatch Tetra commands.
		</p>
	</div>

	<div class="flex flex-1 items-center justify-center p-6 text-center">
		<div class="max-w-md">
			<div class="mx-auto flex size-10 items-center justify-center border border-border bg-muted/40">
				<Server class="size-5 text-muted-foreground" />
			</div>
			<h2 class="mt-5 text-sm font-semibold text-foreground">
				{hosts.length === 0 ? 'No managed hosts yet' : 'Choose a host'}
			</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				{#if hosts.length === 0}
					Register a Tetra agent to start testing host discovery and command dispatch.
				{:else}
					There {hosts.length === 1 ? 'is' : 'are'} {hosts.length} managed {hosts.length === 1
						? 'host'
						: 'hosts'} available. Pick one from the list on the left to view its details.
				{/if}
			</p>

			{#if hosts.length > 0}
				<div class="mt-5 grid grid-cols-3 border border-border text-left">
					<div class="border-r border-border p-3">
						<p class="text-xs text-muted-foreground">Online</p>
						<p class="mt-1 text-lg font-semibold text-foreground">{onlineHosts}</p>
					</div>
					<div class="border-r border-border p-3">
						<p class="text-xs text-muted-foreground">Offline</p>
						<p class="mt-1 text-lg font-semibold text-foreground">{offlineHosts}</p>
					</div>
					<div class="p-3">
						<p class="text-xs text-muted-foreground">Unknown</p>
						<p class="mt-1 text-lg font-semibold text-foreground">{unknownHosts}</p>
					</div>
				</div>
			{/if}

			<Button
				class="mt-6 gap-2"
				onclick={() => goto(`/projects/${page.params.projectid}/hosts/create`)}
			>
				<Plus class="size-4" />
				Register Host
			</Button>
		</div>
	</div>
</div>
