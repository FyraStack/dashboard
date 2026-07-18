<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import GripVertical from '~icons/lucide/grip-vertical';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Cpu from '~icons/nucleo/cpu';
	import Pencil from '~icons/nucleo/pencil';
	import Trash2 from '~icons/nucleo/trash';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';

	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	let vtDragIndex = $state<number | null>(null);
	let vtDropIndex = $state<number | null>(null);

	function vtDragStart(event: DragEvent, index: number) {
		vtDragIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
			const row = (event.target as HTMLElement).closest('tr');
			if (row) event.dataTransfer.setDragImage(row, 0, 0);
		}
	}

	function vtDragOver(event: DragEvent, index: number) {
		if (vtDragIndex === null) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		vtDropIndex = index;
	}

	function vtDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (vtDragIndex !== null) admin.vtReorder(vtDragIndex, index);
		vtDragIndex = null;
		vtDropIndex = null;
	}

	function vtDragEnd() {
		vtDragIndex = null;
		vtDropIndex = null;
	}

	function vtHandleKeydown(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		admin.vtReorder(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
	}
</script>

<div class="flex-1 overflow-auto">
	<div class="flex items-center justify-end border-b border-border/60 px-5 py-2">
		<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={() => admin.vtOpenCreate()}>
			<Plus class="h-3 w-3" /> Create Type
		</Button>
	</div>
	{#if admin.vmTypes.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<Cpu class="mb-3 h-6 w-6" />
			<p class="text-xs">No VM types yet</p>
			<Button
				variant="outline"
				size="sm"
				class="mt-3 gap-1.5 text-xs"
				onclick={() => admin.vtOpenCreate()}><Plus class="h-3 w-3" /> Create Type</Button
			>
		</div>
	{:else}
		<table class="w-full whitespace-nowrap">
			<thead
				><tr class="border-b border-border">
					<th class="w-8 px-3 py-3"></th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Name</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">ISA</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Cores</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">RAM</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Storage</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Rate</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Cap</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground"
						>Autumn feature</th
					>
					<th class="px-5 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
				</tr></thead
			>
			<tbody class="divide-y divide-border/50">
				{#each admin.vmTypes as vt, index (vt.id)}
					<tr
						class="transition-colors hover:bg-muted/20 {vtDragIndex === index
							? 'opacity-40'
							: ''} {vtDropIndex === index && vtDragIndex !== index ? 'bg-muted/40' : ''}"
						ondragover={(event) => vtDragOver(event, index)}
						ondrop={(event) => vtDrop(event, index)}
					>
						<td class="px-3 py-3">
							<span
								role="button"
								tabindex="0"
								aria-label={`Drag or use arrow keys to reorder ${vt.name}`}
								draggable="true"
								class="flex h-7 w-5 cursor-grab items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:text-muted-foreground focus:outline-none active:cursor-grabbing"
								ondragstart={(event) => vtDragStart(event, index)}
								ondragend={vtDragEnd}
								onkeydown={(event) => vtHandleKeydown(event, index)}
							>
								<GripVertical class="h-3.5 w-3.5" />
							</span>
						</td>
						<td class="px-5 py-3 text-sm font-medium text-foreground">{vt.name}</td>
						<td class="px-5 py-3"
							><Badge variant="secondary" class="text-[10px]">{vt.isa}</Badge></td
						>
						<td class="px-5 py-3 text-sm text-muted-foreground">{vt.cores}</td>
						<td class="px-5 py-3 text-sm text-muted-foreground">{vt.ramCapacity} MB</td>
						<td class="px-5 py-3 text-sm text-muted-foreground">{vt.storageAmount} GB</td>
						<td class="px-5 py-3 text-sm text-muted-foreground">${vt.rate}/hr</td>
						<td class="px-5 py-3 text-sm text-muted-foreground">${vt.cap}/mo</td>
						<td class="max-w-xs truncate px-5 py-3 font-mono text-xs text-muted-foreground">
							{vt.autumnFeatureId ?? 'Not configured'}
						</td>
						<td class="px-5 py-3 text-right">
							<div class="flex items-center justify-end gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
									aria-label={`Edit ${vt.name}`}
									onclick={() => admin.vtOpenEdit(vt)}><Pencil class="h-3 w-3" /></Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
									aria-label={`Delete ${vt.name}`}
									onclick={async () => {
										const ok = await confirmDestructive({
											title: 'Delete VM type',
											description: `Servers may be billed on the ${vt.name} plan. This cannot be undone.`,
											confirmWord: vt.name,
											confirmLabel: 'Delete VM type'
										});
										if (ok) admin.vtRemove(vt.id);
									}}><Trash2 class="h-3 w-3" /></Button
								>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<!-- VM Type Dialog -->
<Dialog.Root bind:open={admin.vtDialogOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{admin.vtEditing ? 'Edit VM Type' : 'Create VM Type'}</Dialog.Title>
			<Dialog.Description
				>{admin.vtEditing
					? 'Update plan specifications.'
					: 'Define a new VM plan.'}</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			{#if admin.vtError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="size-4 shrink-0" />{admin.vtError}
				</div>
			{/if}
			<div class="flex flex-col gap-2">
				<Label>Name</Label><Input bind:value={admin.vtName} placeholder="STACK-XXS" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Architecture</Label>
				<select
					bind:value={admin.vtIsa}
					class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
				>
					<option value="x86">x86</option>
				</select>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div class="flex flex-col gap-2">
					<Label>Cores</Label><Input type="number" bind:value={admin.vtCores} min="1" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>RAM (MB)</Label><Input
						type="number"
						bind:value={admin.vtRam}
						min="128"
						step="128"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Storage (GB)</Label><Input type="number" bind:value={admin.vtStorage} min="1" />
				</div>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>Rate ($/hr)</Label><Input bind:value={admin.vtRate} placeholder="0.007" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>Cap ($/mo)</Label><Input bind:value={admin.vtCap} placeholder="5.00" />
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<Label>Autumn feature ID</Label>
				<Input bind:value={admin.vtAutumnFeatureId} placeholder="vm_shared_1vcpu_1gb_hours" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (admin.vtDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={() => admin.vtSave()}
				disabled={admin.vtSaving || !admin.vtName.trim()}
			>
				{#if admin.vtSaving}<Loader2 class="h-3 w-3 animate-spin" />{/if}{admin.vtEditing
					? 'Save'
					: 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
