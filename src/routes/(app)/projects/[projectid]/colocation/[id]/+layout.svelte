<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Activity,
		BarChart3,
		Disc,
		Globe,
		Plus,
		Power,
		Settings,
		Warehouse
	} from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import {
		setColocationContext,
		type ColocationContext,
		type ColocationTab,
		type ColoUnit
	} from '../colocation-context.svelte';

	let { children }: { children: Snippet } = $props();

	let units = $state<ColoUnit[]>([
		{
			id: 'colo-001',
			name: 'db-primary',
			rackSize: '1U',
			location: 'Rack A12, Slot 24',
			powerDraw: '180W',
			powerBudget: '350W',
			ip: '23.193.50.10',
			status: 'online',
			monthlyRate: '$50',
			created: '2026-02-10'
		},
		{
			id: 'colo-002',
			name: 'storage-node',
			rackSize: '2U',
			location: 'Rack A12, Slot 22-23',
			powerDraw: '340W',
			powerBudget: '500W',
			ip: '23.193.50.11',
			status: 'online',
			monthlyRate: '$85',
			created: '2026-03-01'
		},
		{
			id: 'colo-003',
			name: 'gpu-worker',
			rackSize: '4U',
			location: 'Rack B03, Slot 10-13',
			powerDraw: '0W',
			powerBudget: '700W',
			ip: '23.193.50.12',
			status: 'offline',
			monthlyRate: '$200',
			created: '2026-03-20'
		}
	]);

	let addOpen = $state(false);
	let newName = $state('');
	let newRackSize = $state('1U');
	let unitCounter = $state(3);
	let deleteOpen = $state(false);
	let deleteConfirm = $state('');

	const rackSizes = ['1U', '2U', '4U', '6U'];
	const rackPrices: Record<string, string> = {
		'1U': '$50/mo',
		'2U': '$85/mo',
		'4U': '$200/mo',
		'6U': '$280/mo'
	};

	type TabDef = { id: ColocationTab; label: string; icon: typeof BarChart3 };
	const tabs: TabDef[] = [
		{ id: 'overview', label: 'Overview', icon: BarChart3 },
		{ id: 'networking', label: 'Networking', icon: Globe },
		{ id: 'images', label: 'Images', icon: Disc },
		{ id: 'ipmi', label: 'IPMI', icon: Power },
		{ id: 'sensors', label: 'Sensors', icon: Activity },
		{ id: 'settings', label: 'Settings', icon: Settings }
	];

	let activeTab = $derived.by<ColocationTab>(() => {
		const segment = page.url.pathname.split('/').at(-1);
		return tabs.some((tab) => tab.id === segment) ? (segment as ColocationTab) : 'overview';
	});
	let selectedUnitId = $derived(page.params.id ?? '');
	let selectedUnit = $derived(units.find((unit) => unit.id === selectedUnitId));
	let selectedUnitIdx = $derived(units.findIndex((unit) => unit.id === selectedUnitId));

	function tabHref(tab: ColocationTab, unitId = selectedUnitId) {
		const base = `/projects/${page.params.projectid}/colocation/${encodeURIComponent(unitId)}`;
		return tab === 'overview' ? base : `${base}/${tab}`;
	}

	function addUnit() {
		if (!newName.trim()) return;
		unitCounter += 1;
		const unit: ColoUnit = {
			id: `colo-${String(unitCounter).padStart(3, '0')}`,
			name: newName.trim(),
			rackSize: newRackSize,
			location: `Rack B03, Slot ${unitCounter * 2}`,
			powerDraw: '0W',
			powerBudget: newRackSize === '1U' ? '350W' : newRackSize === '2U' ? '500W' : '700W',
			ip: `23.193.50.${12 + unitCounter}`,
			status: 'provisioning',
			monthlyRate: rackPrices[newRackSize].replace('/mo', ''),
			created: new Date().toISOString().slice(0, 10)
		};
		units.push(unit);
		void goto(resolve(tabHref(activeTab, unit.id) as any));
		setTimeout(() => {
			const idx = units.findIndex((u) => u.id === unit.id);
			if (idx !== -1) units[idx].status = 'online';
		}, 3000);
		newName = '';
		newRackSize = '1U';
		addOpen = false;
	}

	function updateSelectedUnit(changes: Partial<ColoUnit>) {
		if (selectedUnitIdx === -1) return;
		Object.assign(units[selectedUnitIdx], changes);
	}

	function openDeleteUnitDialog() {
		deleteConfirm = '';
		deleteOpen = true;
	}

	function deleteSelectedUnit() {
		if (!selectedUnit || deleteConfirm !== selectedUnit.id) return;
		units = units.filter((unit) => unit.id !== selectedUnit!.id);
		void goto(
			resolve(
				(units[0]
					? tabHref(activeTab, units[0].id)
					: `/projects/${page.params.projectid}/colocation`) as any
			)
		);
		deleteOpen = false;
		deleteConfirm = '';
	}

	const context: ColocationContext = {
		get units() {
			return units;
		},
		get selectedUnit() {
			return selectedUnit;
		},
		get selectedUnitId() {
			return selectedUnitId;
		},
		tabHref,
		updateSelectedUnit,
		openDeleteUnitDialog
	};

	setColocationContext(context);
</script>

<div class="flex flex-1 overflow-hidden">
	<div class="flex w-64 shrink-0 flex-col border-r border-gray-800">
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-4">
			<div class="flex items-center gap-2">
				<Warehouse class="h-4 w-4 text-gray-400" />
				<span class="text-sm font-semibold text-gray-100">Colocation</span>
				<Badge variant="secondary" class="text-[10px]">{units.length}</Badge>
			</div>
			<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={() => (addOpen = true)}>
				<Plus class="h-3.5 w-3.5" />
			</Button>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#each units as unit (unit.id)}
				<a
					class="flex w-full items-center justify-between border-b border-gray-800 px-4 py-3 text-left transition-colors duration-100 {selectedUnitId ===
					unit.id
						? 'bg-gray-800/60'
						: 'hover:bg-gray-800/30'}"
					href={resolve(tabHref(activeTab, unit.id) as any)}
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-gray-100">{unit.name}</p>
						<p class="mt-0.5 text-xs text-gray-500">{unit.rackSize} &bull; {unit.location}</p>
					</div>
					<span
						class="ml-2 h-2 w-2 shrink-0 rounded-full {unit.status === 'online'
							? 'bg-emerald-500'
							: unit.status === 'provisioning'
								? 'animate-pulse bg-amber-500'
								: 'bg-red-500'}"
					></span>
				</a>
			{/each}
			{#if units.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-gray-500">
					<Warehouse class="mb-3 h-6 w-6" />
					<p class="text-xs">No colocation units</p>
				</div>
			{/if}
		</div>
	</div>

	{#if selectedUnit}
		<div class="flex flex-1 flex-col overflow-hidden">
			<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-5">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-gray-200">{selectedUnit.name}</span>
					<Badge
						variant="outline"
						class="text-[10px] {selectedUnit.status === 'online'
							? 'border-emerald-800 bg-emerald-950/40 text-emerald-400'
							: selectedUnit.status === 'provisioning'
								? 'border-amber-800 bg-amber-950/40 text-amber-400'
								: 'border-red-800 bg-red-950/40 text-red-400'}"
					>
						{selectedUnit.status}
					</Badge>
				</div>
				<span class="text-xs font-medium text-gray-400">{selectedUnit.monthlyRate}/mo</span>
			</div>

			<div class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-gray-800 px-2">
				{#each tabs as tab (tab.id)}
					<a
						class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors duration-100 {activeTab ===
						tab.id
							? 'border-b-2 border-red-500 text-gray-50'
							: 'text-gray-500 hover:text-gray-300'}"
						href={resolve(tabHref(tab.id) as any)}
					>
						<tab.icon class="h-3 w-3" />
						{tab.label}
					</a>
				{/each}
			</div>

			<div class="flex flex-1 flex-col overflow-hidden">
				{@render children()}
			</div>
		</div>
	{/if}
</div>

<Dialog.Root bind:open={addOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add Colocation Unit</Dialog.Title>
			<Dialog.Description>Request a new colocation slot in Chicago, IL.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Equipment Name</Label>
				<Input bind:value={newName} placeholder="my-server" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Rack Size</Label>
				<div class="grid grid-cols-4 gap-2">
					{#each rackSizes as size (size)}
						<button
							class="border px-3 py-2 text-center text-sm transition-colors {newRackSize === size
								? 'border-red-500 bg-red-950/20 text-gray-100'
								: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
							onclick={() => (newRackSize = size)}
						>
							{size}
							<span class="mt-0.5 block text-[10px] text-gray-500">{rackPrices[size]}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (addOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={addUnit} disabled={!newName.trim()}>Request Slot</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if selectedUnit}
	<Dialog.Root bind:open={deleteOpen}>
		<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Remove Colocation Unit</Dialog.Title>
				<Dialog.Description>
					This will release the rack space for <strong>{selectedUnit.name}</strong>. Type the unit
					ID to confirm.
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2 py-4">
				<Label>Type unit ID to confirm</Label>
				<Input bind:value={deleteConfirm} placeholder={selectedUnit.id} class="font-mono" />
			</div>
			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (deleteOpen = false)}>Cancel</Button>
				<Button
					variant="outline"
					size="sm"
					class="border-red-700 text-red-400 hover:bg-red-950"
					disabled={deleteConfirm !== selectedUnit.id}
					onclick={deleteSelectedUnit}
				>
					Remove Unit
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
