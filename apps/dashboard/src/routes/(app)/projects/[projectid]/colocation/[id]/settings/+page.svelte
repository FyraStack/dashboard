<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Check from '~icons/lucide/check';
	import X from '~icons/lucide/x';
	import Pencil from '~icons/nucleo/pencil';
	import Trash2 from '~icons/nucleo/trash';
	import { getColocationContext } from '../../colocation-context.svelte';

	const colo = getColocationContext();
	let editingName = $state(false);
	let nameValue = $state('');

	function saveName() {
		colo.updateSelectedUnit({ name: nameValue });
		editingName = false;
	}

	function startEditingName() {
		nameValue = colo.selectedUnit?.name ?? '';
		editingName = true;
	}
</script>

{#if colo.selectedUnit}
	<div class="flex-1 overflow-auto">
		<div class="divide-y divide-border/50">
			<div class="flex items-center justify-between px-5 py-4">
				<div>
					<p class="text-sm font-medium text-foreground">Equipment Name</p>
					{#if editingName}
						<div class="mt-2 flex items-center gap-2">
							<Input bind:value={nameValue} class="h-7 w-48 text-xs" />
							<Button
								variant="ghost"
								size="sm"
								class="h-7 w-7 p-0 text-emerald-500"
								onclick={saveName}><Check class="h-3 w-3" /></Button
							>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 w-7 p-0"
								onclick={() => (editingName = false)}><X class="h-3 w-3" /></Button
							>
						</div>
					{:else}
						<p class="mt-0.5 text-xs text-muted-foreground">{colo.selectedUnit.name}</p>
					{/if}
				</div>
				{#if !editingName}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1.5 px-2 text-xs"
						onclick={startEditingName}
					>
						<Pencil class="h-3 w-3" />
						Edit
					</Button>
				{/if}
			</div>
			{#each [['Rack Size', colo.selectedUnit.rackSize], ['Location', colo.selectedUnit.location], ['Monthly Rate', `${colo.selectedUnit.monthlyRate}/mo`], ['Created', colo.selectedUnit.created]] as [label, value] (label)}
				<div class="flex items-center justify-between px-5 py-3">
					<span class="text-sm text-muted-foreground">{label}</span>
					<span class="text-sm text-foreground">{value}</span>
				</div>
			{/each}
			<div class="px-5 py-4">
				<p class="text-sm font-medium text-red-400">Danger Zone</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					Remove this colocation slot and release the rack space.
				</p>
				<Button
					variant="outline"
					size="sm"
					class="mt-3 gap-1.5 border-red-300 px-4 text-xs text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
					onclick={colo.openDeleteUnitDialog}
				>
					<Trash2 class="h-3 w-3" />
					Remove Unit
				</Button>
			</div>
		</div>
	</div>
{/if}
