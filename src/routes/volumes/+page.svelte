<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		attachVolume as attachProjectVolume,
		createVolume as createProjectVolume,
		deleteVolume as deleteProjectVolume,
		detachVolume as detachProjectVolume
	} from '$lib/remote/volumes.remote';
	import { untrack } from 'svelte';
	import { Plus, Trash2, Link, Unlink, HardDrive } from '@lucide/svelte';

	type PageData = {
		currentProject: { id: string } | null;
		volumes?: LoadedVolume[];
		vms?: LoadedVm[];
	};

	type LoadedVolume = {
		id: string;
		name: string;
		size: number;
		associatedVmId: string | null;
	};

	type LoadedVm = {
		id: string;
		active: boolean;
		live: { disk?: number | null } | null;
	};

	type Volume = {
		id: string;
		name: string;
		size: number;
		used: number;
		usageHistory: number[];
		server: string | null;
		region: string;
		status: 'attached' | 'available' | 'deleting';
	};

	let { data }: { data: PageData } = $props();
	let volumes = $state<Volume[]>([]);

	function getPath(history: number[], max: number, width = 72, height = 20): string {
		if (history.length === 0) return '';
		const points = history.map((val, i) => {
			const x = (i / (history.length - 1)) * width;
			const y = height - (val / max) * height;
			return `${x},${y}`;
		});
		return `M${points.join(' L')}`;
	}

	function getUsageColor(used: number, size: number) {
		const ratio = used / size;
		if (ratio > 0.8) return 'text-rose-500';
		if (ratio > 0.5) return 'text-amber-500';
		return 'text-rose-400';
	}

	function getUsageColorHex(used: number, size: number) {
		const ratio = used / size;
		if (ratio > 0.8) return '#f43f5e';
		if (ratio > 0.5) return '#f59e0b';
		return '#fb7185';
	}

	const serverOptions = $derived((data.vms ?? []).filter((vm) => vm.active).map((vm) => vm.id));

	let createOpen = $state(false);
	let newName = $state('');
	let newSize = $state(25);

	let attachOpen = $state(false);
	let attachTarget = $state<Volume | null>(null);
	let attachServer = $state('');
	let actionError = $state('');

	function buildUsageHistory(size: number, used: number) {
		const safeUsed = Math.max(0, Math.min(size, used));
		const steps = [0.25, 0.45, 0.6, 0.72, 0.82, 0.92, 1];
		return steps.map((step) => Math.round(safeUsed * step));
	}

	$effect(() => {
		const vmMap = new Map((data.vms ?? []).map((vm) => [vm.id, vm]));
		const incoming = (data.volumes ?? []).map((volume) => {
			const vm = volume.associatedVmId ? vmMap.get(volume.associatedVmId) : null;
			const diskGb = Math.round((vm?.live?.disk ?? 0) / (1024 * 1024 * 1024));
			const used = volume.associatedVmId
				? Math.min(volume.size, diskGb || Math.round(volume.size * 0.7))
				: 0;
			return {
				id: volume.id,
				name: volume.name,
				size: volume.size,
				used,
				usageHistory: buildUsageHistory(volume.size, used),
				server: volume.associatedVmId,
				region: 'Chicago',
				status: volume.associatedVmId ? 'attached' : 'available'
			} satisfies Volume;
		});
		untrack(() => {
			volumes = incoming;
			if (!serverOptions.includes(attachServer)) {
				attachServer = serverOptions[0] ?? '';
			}
		});
	});

	async function createVolume() {
		const projectId = data.currentProject?.id;
		if (!projectId || !newName.trim()) return;
		actionError = '';
		try {
			const created = await createProjectVolume({
				projectId,
				name: newName.trim(),
				size: newSize
			});
			volumes = [
				...volumes,
				{
					id: created.id,
					name: newName.trim(),
					size: newSize,
					used: 0,
					usageHistory: buildUsageHistory(newSize, 0),
					server: null,
					region: 'Chicago',
					status: 'available'
				}
			];
			newName = '';
			newSize = 25;
			createOpen = false;
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to create volume.';
		}
	}

	async function deleteVolume(id: string) {
		const idx = volumes.findIndex((v) => v.id === id);
		if (idx === -1) return;
		actionError = '';
		volumes[idx].status = 'deleting';
		try {
			await deleteProjectVolume({ volumeId: id });
			volumes = volumes.filter((v) => v.id !== id);
		} catch (err) {
			volumes[idx].status = volumes[idx].server ? 'attached' : 'available';
			actionError = err instanceof Error ? err.message : 'Failed to delete volume.';
		}
	}

	async function detach(id: string) {
		const idx = volumes.findIndex((v) => v.id === id);
		if (idx === -1) return;
		actionError = '';
		try {
			await detachProjectVolume({ volumeId: id });
			volumes[idx].server = null;
			volumes[idx].used = 0;
			volumes[idx].usageHistory = buildUsageHistory(volumes[idx].size, 0);
			volumes[idx].status = 'available';
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to detach volume.';
		}
	}

	function openAttach(vol: Volume) {
		attachTarget = vol;
		attachServer = serverOptions[0];
		attachOpen = true;
	}

	async function confirmAttach() {
		if (!attachTarget || !attachServer) return;
		const idx = volumes.findIndex((v) => v.id === attachTarget!.id);
		if (idx === -1) return;
		actionError = '';
		try {
			await attachProjectVolume({ volumeId: attachTarget.id, vmId: attachServer });
			volumes[idx].server = attachServer;
			volumes[idx].used = Math.round(volumes[idx].size * 0.7);
			volumes[idx].usageHistory = buildUsageHistory(volumes[idx].size, volumes[idx].used);
			volumes[idx].status = 'attached';
			attachOpen = false;
			attachTarget = null;
		} catch (err) {
			actionError = err instanceof Error ? err.message : 'Failed to attach volume.';
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-fyra-gray-800 px-5">
		<div class="flex items-center gap-2">
			<HardDrive class="h-4 w-4 text-fyra-gray-400" />
			<span class="text-sm font-semibold text-fyra-gray-100">Volumes</span>
			<Badge variant="secondary" class="text-[10px]">{volumes.length}</Badge>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-3 text-xs"
			onclick={() => (createOpen = true)}
		>
			<Plus class="h-3 w-3" />
			Create Volume
		</Button>
	</div>
	{#if actionError}
		<div
			class="border-fyra-red-900/40 border-b bg-fyra-red-950/20 px-5 py-2 text-xs text-fyra-red-400"
		>
			{actionError}
		</div>
	{/if}

	<!-- Volume List -->
	<div class="flex-1 overflow-auto">
		{#each volumes as vol (vol.id)}
			{@const colorClass = getUsageColor(vol.used, vol.size)}
			{@const colorHex = getUsageColorHex(vol.used, vol.size)}
			<div
				class="flex items-center gap-4 border-b border-fyra-gray-800 px-5 py-3 transition-colors duration-100 hover:bg-fyra-gray-800/20 {vol.status ===
				'deleting'
					? 'opacity-40'
					: ''}"
			>
				<!-- Icon -->
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {vol.status ===
					'attached'
						? 'bg-emerald-950/30'
						: 'bg-fyra-gray-800'}"
				>
					<HardDrive
						class="h-5 w-5 {vol.status === 'attached' ? 'text-emerald-400' : 'text-fyra-gray-500'}"
					/>
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-fyra-gray-100">{vol.name}</span>
						{#if vol.status === 'attached'}
							<Badge
								variant="outline"
								class="border-emerald-800 bg-emerald-950/40 text-[10px] text-emerald-400"
								>Attached</Badge
							>
						{:else if vol.status === 'deleting'}
							<Badge variant="outline" class="text-[10px]">Deleting...</Badge>
						{:else}
							<Badge variant="secondary" class="text-[10px]">Available</Badge>
						{/if}
					</div>
					<div class="mt-1 flex items-center gap-3 text-xs text-fyra-gray-600">
						<span>{vol.id}</span>
						<span class="h-1 w-1 rounded-full bg-fyra-gray-700"></span>
						<span>{vol.region}</span>
					</div>
					<!-- Storage Graph (mobile only) -->
					<div class="mt-2 flex items-center gap-2 lg:hidden">
						<div class="h-1.5 w-20 overflow-hidden rounded-full bg-fyra-gray-800">
							<div
								class="h-full rounded-full transition-all duration-500 {vol.used / vol.size > 0.8
									? 'bg-fyra-red-500'
									: vol.used / vol.size > 0.5
										? 'bg-amber-500'
										: 'bg-fyra-red-400'}"
								style="width: {(vol.used / vol.size) * 100}%"
							></div>
						</div>
						<span class="text-[10px] text-fyra-gray-500">
							{vol.used > 0 ? `${vol.used} used` : 'empty'}
						</span>
					</div>
				</div>

				<!-- Usage Chart (desktop only) -->
				<div class="hidden shrink-0 items-center gap-2 lg:flex">
					<div class="relative" style="width: 90px; height: 24px">
						<svg width="90" height="24" class="overflow-visible">
							<defs>
								<linearGradient id="chart-gradient-{vol.id}" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stop-color={colorHex} stop-opacity="0.4" />
									<stop offset="100%" stop-color={colorHex} stop-opacity="0" />
								</linearGradient>
							</defs>
							<path
								d="{getPath(vol.usageHistory, vol.size, 90, 24)} L90,24 L0,24 Z"
								fill="url(#chart-gradient-{vol.id})"
								class={colorClass}
							/>
							<path
								d={getPath(vol.usageHistory, vol.size, 90, 24)}
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								class={colorClass}
							/>
							{#if vol.used > 0}
								<circle
									cx="90"
									cy={24 - (vol.used / vol.size) * 24}
									r="2.5"
									fill="currentColor"
									class={colorClass}
								/>
							{/if}
						</svg>
					</div>
					<span class="w-14 text-right text-[10px] text-fyra-gray-400 tabular-nums">
						{vol.used}/{vol.size} GB
					</span>
				</div>

				<!-- Size -->
				<div class="w-20 text-right">
					<span class="text-sm font-semibold text-fyra-gray-200">{vol.size} GB</span>
				</div>

				<!-- Server -->
				<div class="w-28">
					<span class="text-xs text-fyra-gray-500">{vol.server ?? '—'}</span>
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-1">
					{#if vol.status === 'attached'}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1.5 px-2 text-xs"
							onclick={() => detach(vol.id)}
						>
							<Unlink class="h-3 w-3" />
							Detach
						</Button>
					{:else if vol.status === 'available'}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1.5 px-2 text-xs"
							onclick={() => openAttach(vol)}
						>
							<Link class="h-3 w-3" />
							Attach
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 px-2 text-xs text-fyra-red-400 hover:text-fyra-red-300"
						disabled={vol.status === 'deleting' || vol.status === 'attached'}
						onclick={() => deleteVolume(vol.id)}
					>
						<Trash2 class="h-3 w-3" />
					</Button>
				</div>
			</div>
		{/each}

		{#if volumes.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-fyra-gray-500">
				<HardDrive class="mb-3 h-8 w-8" />
				<p class="text-sm">No volumes yet</p>
			</div>
		{/if}
	</div>
</div>

<!-- Create Volume Dialog -->
<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Volume</Dialog.Title>
			<Dialog.Description>Provision a new block storage volume in Chicago.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Name</Label>
				<Input bind:value={newName} placeholder="my-volume" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Size (GB)</Label>
				<div class="flex items-center gap-3">
					<input
						type="range"
						min="10"
						max="500"
						step="10"
						bind:value={newSize}
						class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-fyra-gray-700 accent-fyra-red-500"
					/>
					<span class="w-16 text-right text-sm font-medium text-fyra-gray-200">{newSize} GB</span>
				</div>
				<p class="text-xs text-fyra-gray-500">
					${(newSize * 0.1).toFixed(2)}/mo at $0.10/GB
				</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={createVolume} disabled={!newName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Attach Volume Dialog -->
<Dialog.Root bind:open={attachOpen}>
	<Dialog.Content class="border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Attach Volume</Dialog.Title>
			<Dialog.Description>
				Attach <strong>{attachTarget?.name}</strong> to a server.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Label>Server</Label>
			<select
				bind:value={attachServer}
				class="w-full appearance-none border border-fyra-gray-700 bg-fyra-gray-800 px-3 py-2 text-sm text-fyra-gray-100 focus:border-fyra-gray-500 focus:outline-none"
			>
				{#each serverOptions as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (attachOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={confirmAttach}>Attach</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
