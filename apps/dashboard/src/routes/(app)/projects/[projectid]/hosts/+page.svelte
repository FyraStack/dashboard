<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		createManagedHost,
		refreshManagedHostCapabilities,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Server from '~icons/nucleo/server';

	type PageData = {
		hosts: ManagedHost[];
	};

	let { data }: { data: PageData } = $props();
	let hosts = $state<ManagedHost[]>(untrack(() => data.hosts ?? []));
	let displayName = $state('');
	let agentUrl = $state('http://127.0.0.1:7777');
	let bearerToken = $state('');
	let actionError = $state('');
	let creating = $state(false);
	let refreshingIds = $state<string[]>([]);

	function formatRelative(value: number | null) {
		if (!value) return 'Never';
		const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 48) return `${hours}h ago`;
		return new Date(value).toLocaleString();
	}

	function stateVariant(state: ManagedHost['connectionState']) {
		if (state === 'online') return 'default';
		if (state === 'offline') return 'destructive';
		return 'secondary';
	}

	function upsertHost(host: ManagedHost) {
		const index = hosts.findIndex((item) => item.id === host.id);
		if (index === -1) {
			hosts = [host, ...hosts];
			return;
		}
		hosts[index] = host;
	}

	async function createHost() {
		const projectId = page.params.projectid;
		if (!projectId || creating) return;
		actionError = '';
		creating = true;

		try {
			const host = await createManagedHost({
				projectId,
				displayName,
				agentUrl,
				bearerToken: bearerToken.trim() || undefined
			});
			hosts = [host, ...hosts];
			displayName = '';
			bearerToken = '';
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to register managed host.');
		} finally {
			creating = false;
		}
	}

	async function refreshHost(hostId: string) {
		if (refreshingIds.includes(hostId)) return;
		actionError = '';
		refreshingIds = [...refreshingIds, hostId];
		try {
			upsertHost(await refreshManagedHostCapabilities({ hostId }));
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to refresh managed host.');
		} finally {
			refreshingIds = refreshingIds.filter((id) => id !== hostId);
		}
	}
</script>

<div class="flex h-full flex-col">
	<div class="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
		<div>
			<h1 class="text-base font-semibold text-foreground">Managed Hosts</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Register Tetra agents and inspect host capabilities.
			</p>
		</div>
	</div>

	<div class="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border lg:grid-cols-[360px_1fr]">
		<section class="bg-background p-5">
			<div class="space-y-4">
				<div>
					<h2 class="text-sm font-semibold text-foreground">Register Host</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						Use a Tetra dev HTTP agent while the production WSS broker is being built.
					</p>
				</div>

				<div class="space-y-2">
					<Label for="host-name">Name</Label>
					<Input id="host-name" bind:value={displayName} placeholder="fedora-server" />
				</div>

				<div class="space-y-2">
					<Label for="agent-url">Agent URL</Label>
					<Input id="agent-url" bind:value={agentUrl} placeholder="http://100.x.y.z:7777" />
				</div>

				<div class="space-y-2">
					<Label for="bearer-token">Bearer token</Label>
					<Input
						id="bearer-token"
						type="password"
						bind:value={bearerToken}
						placeholder="Optional"
					/>
				</div>

				{#if actionError}
					<p class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
						{actionError}
					</p>
				{/if}

				<Button
					class="w-full gap-2"
					onclick={createHost}
					disabled={creating || !displayName.trim()}
				>
					{#if creating}
						<Loader2 class="size-4 animate-spin" />
					{:else}
						<Plus class="size-4" />
					{/if}
					Register
				</Button>
			</div>
		</section>

		<section class="min-h-0 overflow-auto bg-background">
			{#if hosts.length === 0}
				<div class="flex h-full min-h-96 items-center justify-center p-6 text-center">
					<div class="max-w-80 border border-dashed border-border p-8">
						<Server class="mx-auto size-6 text-muted-foreground" />
						<p class="mt-4 text-sm font-medium text-foreground">No managed hosts</p>
						<p class="mt-1 text-xs text-muted-foreground">
							Register a Tetra agent to start testing host discovery.
						</p>
					</div>
				</div>
			{:else}
				<div class="divide-y divide-border">
					{#each hosts as host (host.id)}
						<div class="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
							<button
								type="button"
								class="min-w-0 text-left"
								onclick={() => goto(`/projects/${page.params.projectid}/hosts/${host.id}`)}
							>
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium text-foreground">{host.displayName}</span>
									<Badge variant={stateVariant(host.connectionState)}>
										{host.connectionState}
									</Badge>
								</div>
								<div class="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
									<span>Mode: {host.connectionMode}</span>
									<span>Last seen: {formatRelative(host.lastSeenAt)}</span>
									<span>OS: {host.os ?? 'Unknown'}</span>
									<span>Arch: {host.arch ?? 'Unknown'}</span>
								</div>
								{#if host.lastError}
									<p class="mt-2 text-xs text-destructive">{host.lastError}</p>
								{/if}
							</button>

							<div class="flex items-start gap-2">
								<Button
									variant="outline"
									size="sm"
									class="gap-2"
									onclick={() => refreshHost(host.id)}
									disabled={refreshingIds.includes(host.id)}
								>
									{#if refreshingIds.includes(host.id)}
										<Loader2 class="size-3.5 animate-spin" />
									{:else}
										<RefreshCw class="size-3.5" />
									{/if}
									Refresh
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>
