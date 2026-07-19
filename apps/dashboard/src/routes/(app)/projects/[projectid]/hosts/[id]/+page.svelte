<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { untrack } from 'svelte';
	import {
		deleteManagedHost,
		dispatchManagedHostCommand,
		refreshManagedHostCapabilities,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Send from '~icons/lucide/send';
	import Trash2 from '~icons/nucleo/trash';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	let host = $state(untrack(() => data.host));
	let moduleName = $state('settings');
	let actionName = $state('get_system');
	let payloadJson = $state('{}');
	let responseJson = $state('');
	let actionError = $state('');
	let refreshing = $state(false);
	let dispatching = $state(false);
	let deleting = $state(false);

	function formatDate(value: number | null) {
		return value ? new Date(value).toLocaleString() : 'Never';
	}

	function formatJson(value: unknown) {
		return JSON.stringify(value ?? null, null, 2);
	}

	function formatOs(value: string | null) {
		if (!value) return 'Unknown';
		const normalized = value.trim().toLowerCase();
		if (normalized.includes('ultramarine')) return 'Ultramarine';
		if (normalized === 'linux') return 'Linux';
		return value;
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

	async function dispatchCommand() {
		if (dispatching) return;
		actionError = '';
		responseJson = '';
		dispatching = true;
		try {
			const response = await dispatchManagedHostCommand({
				hostId: host.id,
				module: moduleName,
				action: actionName,
				payloadJson
			});
			responseJson = formatJson(response);
		} catch (err) {
			actionError = getErrorMessage(err, 'Command failed.');
		} finally {
			dispatching = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
	<div class="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="truncate text-base font-semibold text-foreground">{host.displayName}</h1>
				<Badge variant={stateVariant(host.connectionState)}>{host.connectionState}</Badge>
			</div>
			<p class="mt-1 truncate text-xs text-muted-foreground">{host.agentUrl ?? 'No agent URL'}</p>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<Button variant="outline" size="sm" class="gap-2" onclick={refresh} disabled={refreshing || deleting}>
				{#if refreshing}
					<Loader2 class="size-3.5 animate-spin" />
				{:else}
					<RefreshCw class="size-3.5" />
				{/if}
				Refresh
			</Button>
			<Button
				variant="destructive"
				size="sm"
				class="gap-2 text-red-700 dark:text-red-300"
				onclick={deleteHost}
				disabled={deleting}
			>
				{#if deleting}
					<Loader2 class="size-3.5 animate-spin" />
				{:else}
					<Trash2 class="size-3.5" />
				{/if}
				Delete
			</Button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-auto">
		<div class="grid border-b border-border bg-background lg:grid-cols-[320px_1fr]">
			<section class="border-b border-border p-5 lg:border-r lg:border-b-0">
				<h2 class="text-sm font-semibold text-foreground">Host Details</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Current dashboard state for this Tetra agent.
				</p>

				<div class="mt-5 divide-y divide-border border border-border">
					{#each [['Kind', host.hostKind], ['Mode', host.connectionMode], ['Last seen', formatDate(host.lastSeenAt)], ['OS', formatOs(host.os)], ['Arch', host.arch ?? 'Unknown'], ['Agent', host.agentVersion ?? 'Unknown']] as [label, value] (label)}
						<div class="flex items-center justify-between gap-4 px-4 py-3">
							<span class="text-xs text-muted-foreground">{label}</span>
							<span class="truncate text-right text-xs font-medium text-foreground">{value}</span>
						</div>
					{/each}
				</div>

				{#if host.lastError}
					<div class="mt-5 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
						{host.lastError}
					</div>
				{/if}

				{#if actionError}
					<div class="mt-5 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
						{actionError}
					</div>
				{/if}
			</section>

			<section class="p-5">
				<div class="flex items-center justify-between gap-4">
					<div>
						<h2 class="text-sm font-semibold text-foreground">Capabilities</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							Last successful `agent.capabilities` response.
						</p>
					</div>
				</div>
				<pre
					class="mt-4 max-h-[34rem] overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{formatJson(
						host.capabilities
					)}</pre>
			</section>
		</div>

		<section class="p-5">
			<div>
				<h2 class="text-sm font-semibold text-foreground">Dispatch Command</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Send a Tetra command envelope through the dashboard server.
				</p>
			</div>

			<div class="mt-4 grid gap-4 lg:max-w-2xl">
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="module">Module</Label>
						<Input id="module" bind:value={moduleName} />
					</div>
					<div class="space-y-2">
						<Label for="action">Action</Label>
						<Input id="action" bind:value={actionName} />
					</div>
				</div>

				<div class="space-y-2">
					<Label for="payload">Payload JSON</Label>
					<Textarea id="payload" class="min-h-32 font-mono text-xs" bind:value={payloadJson} />
				</div>

				<Button class="w-fit gap-2" onclick={dispatchCommand} disabled={dispatching}>
					{#if dispatching}
						<Loader2 class="size-4 animate-spin" />
					{:else}
						<Send class="size-4" />
					{/if}
					Dispatch
				</Button>

				{#if responseJson}
					<pre
						class="max-h-80 overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{responseJson}</pre>
				{/if}
			</div>
		</section>
	</div>
</div>
