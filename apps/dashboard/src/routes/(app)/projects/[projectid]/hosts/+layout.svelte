<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { ManagedHost } from '$lib/remote/managed-hosts.remote';
	import ChevronDown from '~icons/lucide/chevron-down';
	import Plus from '~icons/lucide/plus';
	import Server from '~icons/nucleo/server';

	type PageData = {
		hosts?: ManagedHost[];
	};

	let { data, children }: { data: PageData; children: import('svelte').Snippet } = $props();
	let hosts = $derived(data.hosts ?? []);
	let mobileListOpen = $state(false);

	const hostsPath = $derived(`/projects/${page.params.projectid}/hosts`);
	const currentPath = $derived(page.url.pathname);
	const isHostsIndex = $derived(currentPath === hostsPath);
	const isCreatePage = $derived(currentPath === `${hostsPath}/create`);
	const listOpen = $derived(mobileListOpen || isHostsIndex);
	const selectedHostId = $derived(
		!isCreatePage && currentPath.startsWith(`${hostsPath}/`) ? currentPath.split('/').pop() : null
	);

	$effect(() => {
		currentPath;
		mobileListOpen = false;
	});

	function stateLabel(state: ManagedHost['connectionState']) {
		if (state === 'online') return 'Online';
		if (state === 'offline') return 'Offline';
		return 'Unknown';
	}

	function stateClass(state: ManagedHost['connectionState']) {
		if (state === 'online') return 'bg-emerald-500';
		if (state === 'offline') return 'bg-red-500';
		return 'bg-muted-foreground';
	}

	function formatRelative(value: number | null) {
		if (!value) return 'Never seen';
		const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 48) return `${hours}h ago`;
		return new Date(value).toLocaleDateString();
	}
</script>

<div class="flex h-full w-full flex-col overflow-hidden lg:flex-row">
	<div
		class="flex w-full shrink-0 flex-col border-b border-border lg:max-h-none lg:w-64 lg:border-r lg:border-b-0 {listOpen
			? 'max-h-[38dvh]'
			: ''}"
	>
		<div class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 lg:h-10">
			<div class="flex min-w-0 items-center">
				<span class="text-base font-semibold text-foreground lg:text-sm">Hosts</span>
				<Badge variant="secondary" class="ml-2 text-xs lg:text-[10px]">{hosts.length}</Badge>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				{#if !isHostsIndex}
					<button
						type="button"
						class="relative flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground lg:hidden"
						aria-expanded={listOpen}
						aria-label={listOpen ? 'Hide host list' : 'Show host list'}
						onclick={() => (mobileListOpen = !mobileListOpen)}
					>
						<span
							class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
							aria-hidden="true"
						></span>
						<ChevronDown class="h-4 w-4 transition-transform {listOpen ? 'rotate-180' : ''}" />
					</button>
				{/if}
				<Button
					variant="outline"
					size="sm"
					aria-label="Register host"
					class="relative h-8 w-8 p-0 text-primary hover:text-foreground lg:h-6 lg:w-6"
					onclick={() => goto(`${hostsPath}/create`)}
				>
					<span
						class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
						aria-hidden="true"
					></span>
					<Plus class="h-4 w-4 lg:h-3.5 lg:w-3.5" />
				</Button>
			</div>
		</div>

		<div class="flex-1 overflow-y-auto {listOpen ? '' : 'hidden'} lg:block">
			{#each hosts as host (host.id)}
				<a
					class="flex w-full items-start justify-between border-b border-border px-4 py-3 text-left transition-colors duration-100 {selectedHostId ===
					host.id
						? 'bg-muted/60'
						: 'hover:bg-muted/30'}"
					href={`${hostsPath}/${host.id}`}
					data-sveltekit-preload-data="tap"
				>
					<div class="min-w-0">
						<p class="truncate text-base font-semibold text-foreground lg:text-sm">
							{host.displayName}
						</p>
						<p class="mt-0.5 truncate text-sm text-muted-foreground lg:text-xs">
							{host.connectionMode} &bull; {formatRelative(host.lastSeenAt)}
						</p>
					</div>
					<span
						role="img"
						aria-label={`Status: ${stateLabel(host.connectionState)}`}
						title={stateLabel(host.connectionState)}
						class="mt-1 ml-2 h-2 w-2 shrink-0 rounded-full {stateClass(host.connectionState)}"
					></span>
				</a>
			{/each}

			{#if hosts.length === 0}
				<div class="flex flex-col items-center justify-center py-8 text-muted-foreground lg:py-16">
					<Server class="mb-3 h-6 w-6" />
					<p class="text-sm lg:text-xs">No hosts</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="flex flex-1 flex-col overflow-hidden">
		{@render children()}
	</div>
</div>
