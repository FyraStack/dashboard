<script lang="ts">
	import type { PageProps } from './$types';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		getServer,
		getServerWithFallback,
		requestServerStatusRefresh
	} from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { deleteVm, renameVm } from '$lib/remote/vms.remote';
	import { isValidPtrHostname } from '$lib/ptr';
	import { getErrorMessage } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import Check from '~icons/lucide/check';
	import X from '~icons/lucide/x';
	import Pencil from '~icons/nucleo/pencil';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let nameValue = $state('');
	let syncedServerId = $state('');
	let syncedServerName = $state('');
	let editingName = $state(false);
	let renameDialogOpen = $state(false);
	let updateHostname = $state(false);
	let renaming = $state(false);
	let deleting = $state(false);
	let renameError = $state('');
	let deleteError = $state('');
	let nameChanged = $derived(Boolean(nameValue.trim()) && nameValue.trim() !== selectedServer.name);
	let hostnameValid = $derived(isValidPtrHostname(nameValue.trim()));

	$effect(() => {
		if (selectedServer.id === syncedServerId && selectedServer.name === syncedServerName) return;

		syncedServerId = selectedServer.id;
		syncedServerName = selectedServer.name;
		nameValue = selectedServer.name;
		editingName = false;
		renameDialogOpen = false;
		updateHostname = false;
		renameError = '';
	});

	function openRenameDialog() {
		if (!editingName || !nameChanged || renaming) return;
		updateHostname = false;
		renameError = '';
		renameDialogOpen = true;
	}

	function cancelNameEdit() {
		nameValue = selectedServer.name;
		editingName = false;
	}

	function closeRenameDialog() {
		if (renaming) return;
		renameDialogOpen = false;
		updateHostname = false;
		renameError = '';
	}

	async function handleRename() {
		const name = nameValue.trim();
		const shouldUpdateHostname = updateHostname;
		if (!nameChanged || renaming || (shouldUpdateHostname && !hostnameValid)) return;

		renaming = true;
		renameError = '';

		try {
			const result = await renameVm({
				vmId: selectedServer.id,
				name,
				updateHostname: shouldUpdateHostname
			});
			nameValue = result.name;
			await invalidate('project:vms');
			editingName = false;
			renameDialogOpen = false;
			toast.success(
				shouldUpdateHostname
					? 'Server renamed. The hostname will update after the next reboot.'
					: 'Server renamed.'
			);
		} catch (error) {
			renameError = getErrorMessage(error, 'Failed to rename server.');
		} finally {
			renaming = false;
		}
	}

	async function handleDelete() {
		if (deleting) return;
		const server = selectedServer;
		const projectId = page.params.projectid;
		const ok = await confirmDestructive({
			title: 'Delete server',
			description: `This permanently deletes ${server.name} and all of its data. This cannot be undone.`,
			confirmWord: server.name,
			confirmLabel: 'Delete server'
		});
		if (!ok) return;

		deleting = true;
		deleteError = '';

		try {
			await deleteVm({ vmId: server.id });
			const current = getServer(server.id);
			if (current) current.status = 'deleting';
			requestServerStatusRefresh();
			if (page.params.projectid !== projectId || page.params.id !== server.id) return;
			await goto(resolve(`/projects/${projectId}/servers`), {
				invalidate: ['project:vms']
			});
		} catch {
			deleteError = 'Failed to delete server.';
			deleting = false;
		}
	}
</script>

<div class="max-w-xl space-y-5 p-5">
	<div>
		<h2 class="text-base font-semibold text-foreground sm:text-sm">Server settings</h2>
		<p class="mt-1 text-base text-pretty text-muted-foreground sm:text-sm">
			Manage basic settings for {selectedServer.name}.
		</p>
	</div>
	<div class="space-y-2">
		<Label for="server-name-input">Server name</Label>
		<div class="flex items-center gap-1.5">
			<Input
				id="server-name-input"
				name="serverName"
				bind:value={nameValue}
				disabled={!editingName || renaming}
				onkeydown={(event) => {
					if (event.key === 'Enter') openRenameDialog();
					if (event.key === 'Escape') cancelNameEdit();
				}}
			/>
			{#if editingName}
				<Button
					aria-label="Save server name"
					variant="ghost"
					size="sm"
					class="size-7 p-0 text-emerald-500"
					disabled={!nameChanged || renaming}
					onclick={openRenameDialog}
				>
					<Check class="size-3" />
				</Button>
				<Button
					aria-label="Cancel server name edit"
					variant="ghost"
					size="sm"
					class="size-7 p-0"
					disabled={renaming}
					onclick={cancelNameEdit}
				>
					<X class="size-3" />
				</Button>
			{:else}
				<Button
					aria-label="Edit server name"
					variant="ghost"
					size="sm"
					class="size-7 p-0"
					disabled={selectedServer.status === 'provisioning' ||
						selectedServer.status === 'deleting'}
					onclick={() => (editingName = true)}
				>
					<Pencil class="size-3" />
				</Button>
			{/if}
		</div>
		<p class="text-base text-pretty text-muted-foreground sm:text-sm">
			This is the name shown in the dashboard.
		</p>
	</div>
	<div class="space-y-2">
		<Label for="server-id-input">Server ID</Label><Input
			id="server-id-input"
			name="serverId"
			value={selectedServer.id}
			disabled
			class="font-mono"
		/>
	</div>
	{#if deleteError}
		<p class="text-base text-pretty text-destructive sm:text-sm">{deleteError}</p>
	{/if}
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

<Dialog.Root
	bind:open={renameDialogOpen}
	onOpenChange={(open) => {
		if (!open) closeRenameDialog();
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename server?</Dialog.Title>
			<Dialog.Description class="text-base text-pretty sm:text-sm">
				This changes <strong>{selectedServer.name}</strong> to <strong>{nameValue.trim()}</strong> in
				the dashboard.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-2">
			<div class="flex items-start justify-between gap-4 rounded-lg bg-muted/50 p-3">
				<div class="min-w-0 space-y-1">
					<Label for="update-server-hostname">Update guest hostname</Label>
					<p
						id="update-server-hostname-description"
						class="text-base text-pretty text-muted-foreground sm:text-sm"
					>
						Also set the VM hostname to <span class="font-mono text-foreground"
							>{nameValue.trim()}</span
						>. This takes effect after the next reboot and re-runs first-boot setup.
					</p>
				</div>
				<Switch
					id="update-server-hostname"
					bind:checked={updateHostname}
					aria-describedby="update-server-hostname-description"
					aria-invalid={updateHostname && !hostnameValid}
					disabled={renaming}
				/>
			</div>
			{#if updateHostname && !hostnameValid}
				<p class="pt-2 text-base text-pretty text-destructive sm:text-sm">
					Use a valid hostname with letters, numbers, dots, or hyphens, or leave this option off.
				</p>
			{/if}
			{#if renameError}
				<p class="pt-2 text-base text-pretty text-destructive sm:text-sm">{renameError}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" size="sm" disabled={renaming} onclick={closeRenameDialog}
				>Cancel</Button
			>
			<Button
				size="sm"
				loading={renaming}
				disabled={!nameChanged || (updateHostname && !hostnameValid)}
				onclick={handleRename}>Rename</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
