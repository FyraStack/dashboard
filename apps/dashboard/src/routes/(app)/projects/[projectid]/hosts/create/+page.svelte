<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { createManagedHost } from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import Server from '~icons/nucleo/server';

	let displayName = $state('');
	let agentUrl = $state('http://127.0.0.1:7777');
	let bearerToken = $state('');
	let actionError = $state('');
	let creating = $state(false);

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
			displayName = '';
			bearerToken = '';
			await invalidate('project:managed-hosts');
			await goto(`/projects/${projectId}/hosts/${host.id}`);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to register managed host.');
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col overflow-auto bg-background">
	<div class="border-b border-border px-5 py-4">
		<div class="flex items-center gap-2">
			<Server class="size-4 text-muted-foreground" />
			<h1 class="text-base font-semibold text-foreground">Register Host</h1>
		</div>
		<p class="mt-1 text-xs text-muted-foreground">
			Register a Tetra agent to inspect host capabilities and dispatch commands.
		</p>
	</div>

	<div class="flex flex-1 items-start justify-center p-6 sm:p-8">
		<form
			class="w-full max-w-md space-y-5"
			onsubmit={(event) => {
				event.preventDefault();
				createHost();
			}}
		>
			<div class="space-y-2">
				<Label for="host-name">Name</Label>
				<Input id="host-name" bind:value={displayName} placeholder="fedora-server" />
			</div>

			<div class="space-y-2">
				<Label for="agent-url">Agent URL</Label>
				<Input id="agent-url" bind:value={agentUrl} placeholder="http://100.x.y.z:7777" />
				<p class="text-xs text-muted-foreground">
					Use a Tetra dev HTTP agent while the production WSS broker is being built.
				</p>
			</div>

			<div class="space-y-2">
				<Label for="bearer-token">Bearer token</Label>
				<Input id="bearer-token" type="password" bind:value={bearerToken} placeholder="Optional" />
			</div>

			{#if actionError}
				<p class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
					{actionError}
				</p>
			{/if}

			<Button type="submit" class="w-full gap-2" disabled={creating || !displayName.trim()}>
				{#if creating}
					<Loader2 class="size-4 animate-spin" />
				{:else}
					<Plus class="size-4" />
				{/if}
				Register Host
			</Button>
		</form>
	</div>
</div>
