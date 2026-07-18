<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CreateVolumeDialog from '$lib/components/dialogs/create-volume-dialog.svelte';
	import AttachVolumeDialog from '$lib/components/dialogs/attach-volume-dialog.svelte';
	import {
		attachVolume as attachProjectVolume,
		createVolume as createProjectVolume,
		deleteVolume as deleteProjectVolume,
		detachVolume as detachProjectVolume
	} from '$lib/remote/volumes.remote';
	import { getErrorMessage } from '$lib/utils';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { untrack } from 'svelte';
	import Plus from '~icons/lucide/plus';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Link from '~icons/nucleo/link';
	import Trash2 from '~icons/nucleo/trash';
	import Unlink from '~icons/nucleo/unlink';

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
	let creatingVolume = $state(false);
	let attachingVolume = $state(false);
	let detachingVolumeIds = $state<string[]>([]);
	let deletingVolumeIds = $state<string[]>([]);

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
		const projectId = page.params.projectid;
		if (!projectId || !newName.trim() || creatingVolume) return;
		actionError = '';
		creatingVolume = true;
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
			actionError = getErrorMessage(err, 'Failed to create volume.');
		} finally {
			creatingVolume = false;
		}
	}

	async function deleteVolume(id: string) {
		if (deletingVolumeIds.includes(id)) return;
		const idx = volumes.findIndex((v) => v.id === id);
		if (idx === -1) return;
		const ok = await confirmDestructive({
			title: 'Delete volume',
			description: `This permanently destroys all data on ${volumes[idx].name} and cannot be undone.`,
			confirmWord: volumes[idx].name,
			confirmLabel: 'Delete volume'
		});
		if (!ok) return;
		actionError = '';
		deletingVolumeIds = [...deletingVolumeIds, id];
		volumes[idx].status = 'deleting';
		try {
			await deleteProjectVolume({ volumeId: id });
			volumes = volumes.filter((v) => v.id !== id);
		} catch (err) {
			volumes[idx].status = volumes[idx].server ? 'attached' : 'available';
			actionError = getErrorMessage(err, 'Failed to delete volume.');
		} finally {
			deletingVolumeIds = deletingVolumeIds.filter((item) => item !== id);
		}
	}

	async function detach(id: string) {
		if (detachingVolumeIds.includes(id)) return;
		const idx = volumes.findIndex((v) => v.id === id);
		if (idx === -1) return;
		actionError = '';
		detachingVolumeIds = [...detachingVolumeIds, id];
		try {
			await detachProjectVolume({ volumeId: id });
			volumes[idx].server = null;
			volumes[idx].used = 0;
			volumes[idx].usageHistory = buildUsageHistory(volumes[idx].size, 0);
			volumes[idx].status = 'available';
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to detach volume.');
		} finally {
			detachingVolumeIds = detachingVolumeIds.filter((item) => item !== id);
		}
	}

	function openAttach(vol: Volume) {
		attachTarget = vol;
		attachServer = serverOptions[0];
		attachOpen = true;
	}

	async function confirmAttach() {
		if (!attachTarget || !attachServer || attachingVolume) return;
		const idx = volumes.findIndex((v) => v.id === attachTarget!.id);
		if (idx === -1) return;
		actionError = '';
		attachingVolume = true;
		try {
			await attachProjectVolume({ volumeId: attachTarget.id, vmId: attachServer });
			volumes[idx].server = attachServer;
			volumes[idx].used = Math.round(volumes[idx].size * 0.7);
			volumes[idx].usageHistory = buildUsageHistory(volumes[idx].size, volumes[idx].used);
			volumes[idx].status = 'attached';
			attachOpen = false;
			attachTarget = null;
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to attach volume.');
		} finally {
			attachingVolume = false;
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-5">
		<div class="flex items-center gap-2">
			<HardDrive class="h-4 w-4 text-muted-foreground" />
			<span class="text-sm font-semibold text-foreground">Volumes</span>
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
			class="border-b border-red-300 bg-red-100 px-5 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
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
				class="flex items-center gap-4 border-b border-border px-5 py-3 transition-colors duration-100 hover:bg-muted/20 {vol.status ===
				'deleting'
					? 'opacity-40'
					: ''}"
			>
				<!-- Icon -->
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {vol.status ===
					'attached'
						? 'bg-emerald-100 dark:bg-emerald-950/30'
						: 'bg-muted'}"
				>
					<HardDrive
						class="h-5 w-5 {vol.status === 'attached'
							? 'text-emerald-700 dark:text-emerald-400'
							: 'text-muted-foreground'}"
					/>
				</div>

				<!-- Info -->
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-foreground">{vol.name}</span>
						{#if vol.status === 'attached'}
							<Badge
								variant="outline"
								class="border-emerald-300 bg-emerald-100 text-[10px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
								>Attached</Badge
							>
						{:else if vol.status === 'deleting'}
							<Badge variant="outline" class="text-[10px]">Deleting...</Badge>
						{:else}
							<Badge variant="secondary" class="text-[10px]">Available</Badge>
						{/if}
					</div>
					<div class="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
						<span>{vol.id}</span>
						<span class="h-1 w-1 rounded-full bg-muted"></span>
						<span>{vol.region}</span>
					</div>
					<!-- Storage Graph (mobile only) -->
					<div class="mt-2 flex items-center gap-2 lg:hidden">
						<div class="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full transition-all duration-500 {vol.used / vol.size > 0.8
									? 'bg-red-500'
									: vol.used / vol.size > 0.5
										? 'bg-amber-500'
										: 'bg-red-400'}"
								style="width: {(vol.used / vol.size) * 100}%"
							></div>
						</div>
						<span class="text-[10px] text-muted-foreground">
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
					<span class="w-14 text-right text-[10px] text-muted-foreground tabular-nums">
						{vol.used}/{vol.size} GB
					</span>
				</div>

				<!-- Size -->
				<div class="w-20 text-right">
					<span class="text-sm font-semibold text-foreground">{vol.size} GB</span>
				</div>

				<!-- Server -->
				<div class="w-28">
					<span class="text-xs text-muted-foreground">{vol.server ?? '-'}</span>
				</div>

				<!-- Actions -->
				<div class="flex items-center gap-1">
					{#if vol.status === 'attached'}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1.5 px-2 text-xs"
							onclick={() => detach(vol.id)}
							disabled={detachingVolumeIds.includes(vol.id)}
						>
							<Unlink class="h-3 w-3" />
							{detachingVolumeIds.includes(vol.id) ? 'Detaching...' : 'Detach'}
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
						class="h-7 px-2 text-xs text-red-400 hover:text-red-300"
						aria-label={`Delete ${vol.name}`}
						disabled={vol.status === 'deleting' ||
							vol.status === 'attached' ||
							deletingVolumeIds.includes(vol.id)}
						onclick={() => deleteVolume(vol.id)}
					>
						<Trash2 class="h-3 w-3" />
					</Button>
				</div>
			</div>
		{/each}

		{#if volumes.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
				<HardDrive class="mb-3 h-8 w-8" />
				<p class="text-sm">No volumes yet</p>
			</div>
		{/if}
	</div>
</div>

<!-- Create Volume Dialog -->
<CreateVolumeDialog
	bind:open={createOpen}
	bind:name={newName}
	bind:size={newSize}
	submitting={creatingVolume}
	onSubmit={createVolume}
/>

<!-- Attach Volume Dialog -->
<AttachVolumeDialog
	bind:open={attachOpen}
	volumeName={attachTarget?.name}
	bind:server={attachServer}
	{serverOptions}
	submitting={attachingVolume}
	onSubmit={confirmAttach}
/>
