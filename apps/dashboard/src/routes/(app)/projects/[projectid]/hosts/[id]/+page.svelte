<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { untrack } from 'svelte';
	import {
		dispatchManagedHostCommand,
		refreshManagedHostCapabilities,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Send from '~icons/lucide/send';

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

	function formatDate(value: number | null) {
		return value ? new Date(value).toLocaleString() : 'Never';
	}

	function formatJson(value: unknown) {
		return JSON.stringify(value ?? null, null, 2);
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

<div class="flex h-full min-h-0 flex-col">
	<div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="truncate text-base font-semibold text-foreground">{host.displayName}</h1>
				<Badge variant={stateVariant(host.connectionState)}>{host.connectionState}</Badge>
			</div>
			<p class="mt-1 truncate text-xs text-muted-foreground">{host.agentUrl ?? 'No agent URL'}</p>
		</div>
		<Button variant="outline" size="sm" class="gap-2" onclick={refresh} disabled={refreshing}>
			{#if refreshing}
				<Loader2 class="size-3.5 animate-spin" />
			{:else}
				<RefreshCw class="size-3.5" />
			{/if}
			Refresh
		</Button>
	</div>

	<div
		class="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-border lg:grid-cols-[360px_1fr]"
	>
		<section class="space-y-5 overflow-auto bg-background p-5">
			<div>
				<h2 class="text-sm font-semibold text-foreground">Host Details</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Current dashboard state for this Tetra agent.
				</p>
			</div>

			<div class="divide-y divide-border border border-border">
				{#each [['Kind', host.hostKind], ['Mode', host.connectionMode], ['Last seen', formatDate(host.lastSeenAt)], ['OS', host.os ?? 'Unknown'], ['Arch', host.arch ?? 'Unknown'], ['Agent', host.agentVersion ?? 'Unknown']] as [label, value] (label)}
					<div class="flex items-center justify-between gap-4 px-4 py-3">
						<span class="text-xs text-muted-foreground">{label}</span>
						<span class="truncate text-right text-xs font-medium text-foreground">{value}</span>
					</div>
				{/each}
			</div>

			{#if host.lastError}
				<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
					{host.lastError}
				</div>
			{/if}

			{#if actionError}
				<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
					{actionError}
				</div>
			{/if}
		</section>

		<section class="min-h-0 overflow-auto bg-background">
			<div class="grid gap-px bg-border xl:grid-cols-2">
				<div class="bg-background p-5">
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
				</div>

				<div class="bg-background p-5">
					<div>
						<h2 class="text-sm font-semibold text-foreground">Dispatch Command</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							Send a Tetra command envelope through the dashboard server.
						</p>
					</div>

					<div class="mt-4 grid gap-4">
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

						<Button class="gap-2" onclick={dispatchCommand} disabled={dispatching}>
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
				</div>
			</div>
		</section>
	</div>
</div>
