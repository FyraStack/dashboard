<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ComingSoon from '$lib/components/coming-soon.svelte';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { deleteVm } from '$lib/remote/vms.remote';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let nameValue = $derived(selectedServer.name);
	let deleting = $state(false);
	let deleteError = $state('');

	async function handleDelete() {
		if (deleting) return;
		const ok = await confirmDestructive({
			title: 'Delete server',
			description: `This permanently deletes ${selectedServer.name} and all of its data. This cannot be undone.`,
			confirmWord: selectedServer.name,
			confirmLabel: 'Delete server'
		});
		if (!ok) return;

		deleting = true;
		deleteError = '';

		try {
			await deleteVm({ vmId: selectedServer.id });
			await invalidate('project:vms');
			await goto(resolve(`/projects/${page.params.projectid}/servers`));
		} catch {
			deleteError = 'Failed to delete server.';
			deleting = false;
		}
	}
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-sm font-semibold text-foreground">Server Settings</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Manage basic settings for {selectedServer.name}.
		</p>
	</div>
	<div class="space-y-2">
		<Label for="server-name-input">Server Name</Label><Input
			id="server-name-input"
			bind:value={nameValue}
			disabled
		/>
	</div>
	<div class="space-y-2">
		<Label for="server-id-input">Server ID</Label><Input
			id="server-id-input"
			value={selectedServer.id}
			disabled
			class="font-mono"
		/>
	</div>
	{#if deleteError}
		<p class="text-xs text-red-400">{deleteError}</p>
	{/if}
	<div class="flex items-center gap-2">
		<Button size="sm" disabled>Save Changes</Button>
		<ComingSoon />
	</div>
	<div class="border-t border-border pt-4">
		<Button
			variant="outline"
			size="sm"
			disabled={deleting || selectedServer.status === 'deleting'}
			onclick={handleDelete}
			class="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
		>
			{deleting || selectedServer.status === 'deleting' ? 'Deleting...' : 'Delete Server'}</Button
		>
	</div>
</div>
