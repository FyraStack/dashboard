<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { confirmDestructive } from '#lib/confirm.svelte.js';
	import { dependencies } from '#lib/dependencies.js';
	import { bytesToGib, formatUsd } from '#lib/format.js';
	import { runOptimistic } from '#lib/optimistic.js';
	import {
		attachVolume as attachProjectVolume,
		createVolume as createProjectVolume,
		deleteVolume as deleteProjectVolume,
		detachVolume as detachProjectVolume
	} from '#lib/remote/volumes.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Plus from '~icons/lucide/plus';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Link from '~icons/nucleo/link';
	import Trash2 from '~icons/nucleo/trash';
	import Unlink from '~icons/nucleo/unlink';
	import type { PageProps } from './$types';

	interface Volume {
		id: string;
		name: string;
		region: string;
		server: string | null;
		size: number;
		status: 'attached' | 'available' | 'deleting';
		usageHistory: number[];
		used: number;
	}

	let { data }: PageProps = $props();
	let volumes = $state<Volume[]>([]);

	function usageBarClass(usedRatio: number): string {
		if (usedRatio > 0.8) {
			return 'bg-red-500';
		}
		if (usedRatio > 0.5) {
			return 'bg-amber-500';
		}
		return 'bg-red-400';
	}

	function getPath(history: number[], max: number, width = 72, height = 20): string {
		if (history.length === 0) {
			return '';
		}
		const lastIndex = Math.max(history.length - 1, 1);
		const points = history.map((val, i) => {
			const x = (i / lastIndex) * width;
			const y = height - (val / max) * height;
			return `${x},${y}`;
		});
		return `M${points.join(' L')}`;
	}

	function getUsageColor(used: number, size: number) {
		const ratio = used / size;
		if (ratio > 0.8) {
			return 'text-rose-500';
		}
		if (ratio > 0.5) {
			return 'text-amber-500';
		}
		return 'text-rose-400';
	}

	function getUsageColorHex(used: number, size: number) {
		const ratio = used / size;
		if (ratio > 0.8) {
			return '#f43f5e';
		}
		if (ratio > 0.5) {
			return '#f59e0b';
		}
		return '#fb7185';
	}

	const serverOptions = $derived(data.vms.filter((vm) => vm.active).map((vm) => vm.id));

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
		const vmMap = new Map(data.vms.map((vm) => [vm.id, vm]));
		const incoming = data.volumes.map((volume) => {
			const vm = volume.associatedVmId ? vmMap.get(volume.associatedVmId) : null;
			const diskGb = Math.round(bytesToGib(vm?.live?.disk ?? 0));
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
		if (!(projectId && newName.trim()) || creatingVolume) {
			return;
		}
		actionError = '';
		creatingVolume = true;
		try {
			await createProjectVolume({ projectId, name: newName.trim(), size: newSize });
			newName = '';
			newSize = 25;
			createOpen = false;
			await invalidate(dependencies.project.volumes);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to create volume.');
		} finally {
			creatingVolume = false;
		}
	}

	async function deleteVolume(id: string) {
		if (deletingVolumeIds.includes(id)) {
			return;
		}
		const idx = volumes.findIndex((v) => v.id === id);
		if (idx === -1) {
			return;
		}
		const ok = await confirmDestructive({
			title: 'Delete volume',
			description: `This permanently destroys all data on ${volumes[idx].name} and cannot be undone.`,
			confirmWord: volumes[idx].name,
			confirmLabel: 'Delete volume'
		});
		if (!ok) {
			return;
		}
		actionError = '';
		deletingVolumeIds = [...deletingVolumeIds, id];
		try {
			await runOptimistic({
				apply: () => {
					const volume = volumes[idx];
					const previousStatus = volume.status;
					volume.status = 'deleting';
					return () => {
						volume.status = previousStatus;
					};
				},
				commit: () => deleteProjectVolume({ volumeId: id }),
				invalidates: [dependencies.project.volumes]
			});
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to delete volume.');
		} finally {
			deletingVolumeIds = deletingVolumeIds.filter((item) => item !== id);
		}
	}

	async function detach(id: string) {
		if (detachingVolumeIds.includes(id)) {
			return;
		}
		actionError = '';
		detachingVolumeIds = [...detachingVolumeIds, id];
		try {
			await detachProjectVolume({ volumeId: id });
			await invalidate(dependencies.project.volumes);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to detach volume.');
		} finally {
			detachingVolumeIds = detachingVolumeIds.filter((item) => item !== id);
		}
	}

	function openAttach(vol: Volume) {
		attachTarget = vol;
		[attachServer] = serverOptions;
		attachOpen = true;
	}

	async function confirmAttach() {
		if (!(attachTarget && attachServer) || attachingVolume) {
			return;
		}
		const volumeId = attachTarget.id;
		actionError = '';
		attachingVolume = true;
		try {
			await attachProjectVolume({ volumeId, vmId: attachServer });
			attachOpen = false;
			attachTarget = null;
			await invalidate(dependencies.project.volumes);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to attach volume.');
		} finally {
			attachingVolume = false;
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
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
					<div class="mt-2 flex items-center gap-2 lg:hidden">
						<div class="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full transition-all duration-500 {usageBarClass(
									vol.used / vol.size
								)}"
								style="width: {(vol.used / vol.size) * 100}%"
							></div>
						</div>
						<span class="text-[10px] text-muted-foreground">
							{vol.used > 0 ? `${vol.used} used` : 'empty'}
						</span>
					</div>
				</div>

				<div class="hidden shrink-0 items-center gap-2 lg:flex">
					<div class="relative" style="width: 90px; height: 24px">
						<svg width="90" height="24" class="overflow-visible" aria-hidden="true">
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
						{vol.used}/{vol.size}
						GB
					</span>
				</div>

				<div class="w-20 text-right">
					<span class="text-sm font-semibold text-foreground">{vol.size} GB</span>
				</div>

				<div class="w-28">
					<span class="text-xs text-muted-foreground">{vol.server ?? '-'}</span>
				</div>

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

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
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
						class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-red-500"
					/>
					<span class="w-16 text-right text-sm font-medium text-foreground">{newSize} GB</span>
				</div>
				<p class="text-xs text-muted-foreground">{formatUsd(newSize * 0.1)}/mo at $0.10/GB</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				size="sm"
				onclick={() => (createOpen = false)}
				disabled={creatingVolume}
				>Cancel</Button
			>
			<Button size="sm" onclick={createVolume} disabled={!newName.trim() || creatingVolume}
				>{creatingVolume ? 'Creating...' : 'Create'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={attachOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Attach Volume</Dialog.Title>
			<Dialog.Description
				>Attach {attachTarget?.name ?? 'this volume'} to a server.</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Label>Server</Label>
			<select
				bind:value={attachServer}
				class="w-full appearance-none border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
			>
				{#each serverOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				size="sm"
				onclick={() => (attachOpen = false)}
				disabled={attachingVolume}
				>Cancel</Button
			>
			<Button size="sm" onclick={confirmAttach} disabled={attachingVolume || !attachServer}
				>{attachingVolume ? 'Attaching...' : 'Attach'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
