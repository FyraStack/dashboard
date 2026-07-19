<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import {
		deleteManagedHost,
		refreshManagedHostCapabilities,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Trash2 from '~icons/nucleo/trash';
	import { untrack } from 'svelte';
	import { hostTabs, type HostTab } from './lib/host-detail';

	type HostTabHref =
		| `/projects/${string}/hosts/${string}`
		| `/projects/${string}/hosts/${string}/podman`
		| `/projects/${string}/hosts/${string}/dispatch`;

	type LayoutData = {
		host: ManagedHost;
	};

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let host = $state<ManagedHost>(untrack(() => data.host));
	let refreshing = $state(false);
	let deleting = $state(false);
	let actionError = $state('');

	$effect(() => {
		host = data.host;
	});

	let activeTab = $derived.by<HostTab>(() => {
		const tab = page.url.pathname.split('/').pop();
		return hostTabs.some((entry) => entry.id === tab) ? (tab as HostTab) : 'overview';
	});

	function tabHref(tab: HostTab): HostTabHref {
		const base = `/projects/${page.params.projectid}/hosts/${host.id}`;
		return (tab === 'overview' ? base : `${base}/${tab}`) as HostTabHref;
	}

	function stateVariant(state: ManagedHost['connectionState']) {
		if (state === 'online') return 'default';
		if (state === 'offline') return 'destructive';
		return 'secondary';
	}

	async function refresh() {
		if (refreshing) return;
		actionError = '';
		refreshing = true;
		try {
			host = await refreshManagedHostCapabilities({ hostId: host.id });
			await invalidate(`managed-host:${host.id}`);
			await invalidate('project:managed-hosts');
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to refresh host.');
		} finally {
			refreshing = false;
		}
	}

	async function deleteHost() {
		if (deleting) return;
		const ok = await confirmDestructive({
			title: 'Delete managed host',
			description: `This will remove ${host.displayName} from the dashboard. The Tetra agent itself will not be uninstalled from the host.`,
			confirmWord: host.displayName,
			confirmLabel: 'Delete host'
		});
		if (!ok) return;

		deleting = true;
		actionError = '';
		try {
			await deleteManagedHost({ hostId: host.id });
			await invalidate('project:managed-hosts');
			await goto(`/projects/${page.params.projectid}/hosts`);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to delete host.');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
	<div class="flex min-w-0 items-center gap-2">
		<span class="truncate text-sm font-medium text-foreground">{host.displayName}</span>
		<Badge variant={stateVariant(host.connectionState)} class="text-[10px]">
			{host.connectionState}
		</Badge>
		<span class="hidden truncate text-xs text-muted-foreground sm:inline">
			{host.agentUrl ?? 'No agent URL'}
		</span>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		<Button variant="outline" size="sm" class="h-7 gap-1.5 px-2.5 text-xs sm:px-3" onclick={refresh} disabled={refreshing || deleting}>
			{#if refreshing}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<RefreshCw class="h-3 w-3" />
			{/if}
			<span class="hidden sm:inline">Refresh</span>
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 border-red-300 px-2.5 text-xs text-red-700 hover:bg-red-100 sm:px-3 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
			onclick={deleteHost}
			disabled={deleting}
		>
			{#if deleting}
				<Loader2 class="h-3 w-3 animate-spin" />
			{:else}
				<Trash2 class="h-3 w-3" />
			{/if}
			<span class="hidden sm:inline">Delete</span>
		</Button>
	</div>
</div>

<div class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border px-2">
	{#each hostTabs as tab (tab.id)}
		<a
			aria-current={activeTab === tab.id ? 'page' : undefined}
			class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors duration-100 {activeTab ===
			tab.id
				? 'border-b-2 border-red-500 text-foreground'
				: 'text-muted-foreground hover:text-foreground'}"
			href={resolve(tabHref(tab.id))}
			data-sveltekit-preload-data="hover"
		>
			<tab.icon class="h-3 w-3" />
			{tab.label}
		</a>
	{/each}
</div>

{#if actionError}
	<div class="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
		{actionError}
	</div>
{/if}

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
	{@render children()}
</div>
