<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import Icon from '$lib/components/icon.svelte';
	import ComingSoon from '$lib/components/coming-soon.svelte';
	import {
		officialImages,
		imageTypeColors,
		type OfficialImage,
		type ImageType
	} from '$lib/data/images';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Disc from '~icons/nucleo/disc';
	import DollarSign from '~icons/nucleo/dollar-sign';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Search from '~icons/nucleo/search';
	import Trash2 from '~icons/nucleo/trash';
	import Upload from '~icons/nucleo/upload';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let imgSearch = $state('');
	let imgPage = $state(0);
	const imgPerPage = 6;
	let mountedImage = $state<string | null>(null);
	let rebuildFromImage = $state<{ name: string; version: string } | null>(null);
	let rebuildImageConfirm = $state('');
	let imgUploadOpen = $state(false);

	type UserImage = {
		id: string;
		name: string;
		type: ImageType;
		size: string;
		uploaded: string;
	};

	let vmUserImages = $state<UserImage[]>([
		{
			id: 'img-001',
			name: 'custom-fedora-qcow2',
			type: 'qcow2',
			size: '1.8 GB',
			uploaded: '2026-04-21'
		}
	]);

	let filteredOfficialImages = $derived.by(() => {
		if (!imgSearch.trim()) return officialImages;
		const query = imgSearch.toLowerCase();
		return officialImages.filter(
			(image) =>
				image.name.toLowerCase().includes(query) ||
				image.versions.some((version) => version.version.toLowerCase().includes(query))
		);
	});

	let imgTotalPages = $derived(Math.ceil(filteredOfficialImages.length / imgPerPage));
	let pagedOfficialImages = $derived.by(() => {
		const list = filteredOfficialImages;
		return list.slice(imgPage * imgPerPage, (imgPage + 1) * imgPerPage);
	});
	let filteredVmUserImages = $derived.by(() => {
		if (!imgSearch.trim()) return vmUserImages;
		const query = imgSearch.toLowerCase();
		return vmUserImages.filter((image) => image.name.toLowerCase().includes(query));
	});

	function mountOfficialVersion(name: string, version: string) {
		mountedImage = `${name} ${version}`;
	}

	function mountUserImage(name: string) {
		mountedImage = name;
	}

	function unmountImage() {
		mountedImage = null;
	}

	function startRebuild(name: string, version: string) {
		rebuildFromImage = { name, version };
		rebuildImageConfirm = '';
	}

	function deleteVmImage(id: string) {
		vmUserImages = vmUserImages.filter((image) => image.id !== id);
	}

	function latestVersion(image: OfficialImage) {
		return image.versions[0];
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	{#if mountedImage}
		<div class="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-2.5">
			<div class="flex items-center gap-2">
				<Disc class="h-3 w-3 text-red-400" />
				<span class="text-xs font-medium text-foreground">Mounted: {mountedImage}</span>
			</div>
			<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={unmountImage}
				>Unmount</Button
			>
		</div>
	{/if}

	{#if rebuildFromImage}
		<div class="border-b border-border bg-red-950/10 px-5 py-3">
			<h3 class="text-sm font-semibold text-foreground">
				Rebuild from {rebuildFromImage.name}
				{rebuildFromImage.version}
			</h3>
			<p class="mt-1 text-xs text-muted-foreground">
				This will wipe all data and reinstall from this image. Type the server ID to confirm.
			</p>
			<div class="mt-3 flex items-center gap-2">
				<input
					bind:value={rebuildImageConfirm}
					placeholder={selectedServer.id}
					class="h-8 w-56 border border-border bg-muted px-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
				/>
				<Button
					variant="outline"
					size="sm"
					disabled
					class="gap-1.5 border-red-300 px-3 text-xs text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
				>
					<RotateCw class="h-3 w-3" /> Rebuild
				</Button>
				<ComingSoon />
				<Button
					variant="ghost"
					size="sm"
					class="h-8 px-2 text-xs"
					onclick={() => (rebuildFromImage = null)}
				>
					Cancel
				</Button>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between border-b border-border px-5 py-2.5">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-muted-foreground"
			/>
			<input
				bind:value={imgSearch}
				placeholder="Search images..."
				class="h-7 w-44 border border-border bg-muted pr-2 pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
			/>
		</div>
		<div class="flex items-center gap-2">
			<ComingSoon />
			<Button variant="outline" size="sm" disabled class="h-7 gap-1.5 px-3 text-xs">
				<Upload class="h-3 w-3" /> Upload Image
			</Button>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		<div class="flex items-center justify-between border-b border-border px-5 py-2.5">
			<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>Official Images</span
			>
			{#if imgTotalPages > 1}
				<div class="flex items-center gap-1.5">
					<button
						class="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
						disabled={imgPage === 0}
						onclick={() => imgPage--}
					>
						<ChevronLeft class="h-3.5 w-3.5" />
					</button>
					<span class="text-[10px] text-muted-foreground">{imgPage + 1}/{imgTotalPages}</span>
					<button
						class="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30"
						disabled={imgPage >= imgTotalPages - 1}
						onclick={() => imgPage++}
					>
						<ChevronRight class="h-3.5 w-3.5" />
					</button>
				</div>
			{/if}
		</div>

		<div class="border-b border-border">
			<div class="grid grid-cols-2 gap-px bg-background">
				{#each pagedOfficialImages as image (image.id)}
					{@const version = latestVersion(image)}
					<div
						class="relative flex gap-3 overflow-hidden bg-background p-4 text-left transition-colors hover:bg-muted/40"
					>
						<div
							class="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
							style="background: radial-gradient(120% 120% at 0% 0%, {image.iconColor} 0%, transparent 55%)"
						></div>
						<div class="relative shrink-0">
							{#if image.icon}
								<Icon name={image.icon} class="h-10 w-10 text-muted-foreground" />
							{:else}
								<Disc class="h-10 w-10 text-muted-foreground" />
							{/if}
						</div>
						<div class="relative flex min-w-0 flex-1 flex-col">
							<div class="flex items-center gap-1.5">
								<span class="text-sm font-semibold text-foreground">{image.name}</span>
								{#if image.paid}
									<Badge
										variant="outline"
										class="border-red-700 bg-red-950/40 text-[8px] text-red-400"
									>
										<DollarSign class="mr-0.5 h-2 w-2" />{image.price}
									</Badge>
								{/if}
							</div>
							<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
								{image.description}
							</p>
							<div class="mt-3 flex items-center gap-1.5">
								<Button
									variant="ghost"
									size="sm"
									class="h-6 px-2 text-[10px]"
									onclick={() => mountOfficialVersion(image.name, version.version)}
								>
									Mount {version.version}
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="h-6 px-2 text-[10px]"
									onclick={() => startRebuild(image.name, version.version)}
								>
									Rebuild
								</Button>
							</div>
							<p class="mt-auto pt-1.5 text-[10px] leading-none text-muted-foreground">
								{version.archs.join('  ')} | {image.versions.length} version{image.versions.length >
								1
									? 's'
									: ''}
							</p>
						</div>
					</div>
				{/each}
			</div>
			{#if filteredOfficialImages.length === 0 && imgSearch.trim()}
				<div class="px-5 py-6 text-center text-xs text-muted-foreground">
					No official images match "{imgSearch}"
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between border-b border-border px-5 py-2.5">
			<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>Your Images ({vmUserImages.length})</span
			>
		</div>
		{#if filteredVmUserImages.length > 0}
			<div class="divide-y divide-border/20">
				{#each filteredVmUserImages as image (image.id)}
					<div
						class="flex items-center justify-between px-5 py-3 transition-colors hover:bg-muted/20"
					>
						<div class="flex items-center gap-2">
							<Disc class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
							<span class="text-xs text-foreground">{image.name}</span>
							<Badge variant="outline" class="text-[7px] {imageTypeColors[image.type]}"
								>.{image.type}</Badge
							>
							<span class="text-[10px] text-muted-foreground">{image.size}</span>
						</div>
						<div class="flex items-center gap-1.5">
							{#if mountedImage === image.name}
								<Badge
									variant="outline"
									class="border-emerald-300 bg-emerald-100 text-[9px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
									>Mounted</Badge
								>
							{:else}
								<Button
									variant="ghost"
									size="sm"
									class="h-6 px-2 text-[10px]"
									onclick={() => mountUserImage(image.name)}>Mount</Button
								>
							{/if}
							<Button
								variant="outline"
								size="sm"
								class="h-6 px-2 text-[10px]"
								onclick={() => startRebuild(image.name, '')}>Rebuild</Button
							>
							<span class="text-[10px] text-muted-foreground">{image.uploaded}</span>
							<Button
								variant="ghost"
								size="sm"
								class="h-5 w-5 p-0 text-muted-foreground hover:text-red-400"
								onclick={() => deleteVmImage(image.id)}
							>
								<Trash2 class="h-2.5 w-2.5" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{:else if imgSearch.trim()}
			<div class="px-5 py-3 text-center text-[10px] text-muted-foreground">No matches</div>
		{:else}
			<div class="flex items-center justify-center gap-1.5 py-3 text-muted-foreground">
				<Upload class="h-3 w-3" />
				<p class="text-[10px]">No uploaded images</p>
			</div>
		{/if}
	</div>
</div>
