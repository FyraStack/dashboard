<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Sheet from '$lib/components/ui/sheet';
	import { imageTypeColors } from '$lib/data/images';
	import { ChevronLeft, ChevronRight, Disc, Search } from '@lucide/svelte';

	type PageData = {
		images?: DbImage[];
		proxmoxIsos?: ProxmoxIso[];
	};

	type DbImage = {
		id: string;
		name: string;
		version: string;
		description: string;
		isOfficial: boolean;
		logoSvg: string | null | undefined;
		accentColor: string;
		imageType: string;
		filePath: string;
		isa: string;
	};

	type ProxmoxIso = {
		volid: string;
		filename: string;
		size: number;
		node: string;
	};

	let { data }: { data: PageData } = $props();

	const perPage = 9;
	let page = $state(0);
	let search = $state('');
	let sheetOpen = $state(false);
	let selectedImage = $state<DbImage | null>(null);

	const images = $derived(data.images ?? []);
	const officialImages = $derived(images.filter((image) => image.isOfficial));
	const customImages = $derived(images.filter((image) => !image.isOfficial));

	let filteredOfficialImages = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return officialImages;

		return officialImages.filter(
			(image) =>
				image.name.toLowerCase().includes(q) ||
				image.version.toLowerCase().includes(q) ||
				image.imageType.toLowerCase().includes(q)
		);
	});

	let filteredCustomImages = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return customImages;

		return customImages.filter(
			(image) =>
				image.name.toLowerCase().includes(q) ||
				image.version.toLowerCase().includes(q) ||
				image.imageType.toLowerCase().includes(q)
		);
	});

	let totalPages = $derived(Math.ceil(filteredOfficialImages.length / perPage));
	let pagedImages = $derived(filteredOfficialImages.slice(page * perPage, (page + 1) * perPage));

	function openDetail(image: DbImage) {
		selectedImage = image;
		sheetOpen = true;
	}

	function closeDetail() {
		sheetOpen = false;
		setTimeout(() => (selectedImage = null), 200);
	}

	function imageTypeClass(imageType: string) {
		return imageTypeColors[imageType] ?? 'border-gray-700 bg-gray-800/60 text-gray-400';
	}

	function imageAccent(image: DbImage) {
		return image.accentColor || '#6b7280';
	}

	function logoSrc(image: DbImage) {
		return image.logoSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(image.logoSvg)}` : null;
	}

	function displayArchitecture(image: DbImage) {
		return image.isa || 'x86';
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-5">
		<div class="flex items-center gap-2">
			<Disc class="h-4 w-4 text-gray-400" />
			<span class="text-sm font-semibold text-gray-100">Images</span>
		</div>
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-gray-500"
			/>
			<input
				bind:value={search}
				placeholder="Search images..."
				class="h-7 w-44 border border-gray-700 bg-gray-800 pr-2 pl-7 text-xs text-gray-100 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
			/>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		<div class="flex items-center justify-between border-b border-gray-800 px-5 py-3">
			<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
				>Official Images</span
			>
			{#if totalPages > 1 && !selectedImage}
				<div class="flex items-center gap-1.5">
					<button
						aria-label="Previous page"
						class="flex h-6 w-6 items-center justify-center text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-30"
						disabled={page === 0}
						onclick={() => page--}
					>
						<ChevronLeft class="h-3.5 w-3.5" />
					</button>
					<span class="text-[10px] text-gray-500">{page + 1}/{totalPages}</span>
					<button
						aria-label="Next page"
						class="flex h-6 w-6 items-center justify-center text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-30"
						disabled={page >= totalPages - 1}
						onclick={() => page++}
					>
						<ChevronRight class="h-3.5 w-3.5" />
					</button>
				</div>
			{/if}
		</div>

		<div class="border-b border-gray-800">
			<div class="grid grid-cols-3 gap-px bg-gray-900">
				{#each pagedImages as image (image.id)}
					<button
						class="relative flex gap-4 overflow-hidden bg-gray-900 p-5 text-left transition-colors hover:bg-gray-800/40"
						onclick={() => openDetail(image)}
					>
						<div
							class="pointer-events-none absolute inset-0 opacity-[0.05]"
							style:background={`linear-gradient(135deg, ${imageAccent(image)} 0%, transparent 60%)`}
						></div>
						<div
							class="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-gray-800 bg-gray-950/40 p-2"
						>
							{#if logoSrc(image)}
								<img src={logoSrc(image) ?? ''} alt="" class="h-full w-full object-contain" />
							{:else}
								<Disc class="h-8 w-8 text-gray-300" />
							{/if}
						</div>
						<div class="relative flex min-w-0 flex-1 flex-col">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-sm font-semibold text-gray-50">{image.name}</span>
								<Badge variant="outline" class="text-[8px] {imageTypeClass(image.imageType)}">
									{image.imageType.toUpperCase()}
								</Badge>
							</div>
							<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-gray-500">
								{image.description}
							</p>
							<p class="mt-auto pt-2 text-[10px] leading-none text-gray-500">
								{displayArchitecture(image)} | {image.version}
							</p>
						</div>
					</button>
				{/each}
			</div>
			{#if filteredOfficialImages.length === 0 && search.trim()}
				<div class="px-5 py-8 text-center text-xs text-gray-500">
					No official images match "{search}"
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between border-b border-gray-800 px-5 py-2.5">
			<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">
				Your Images ({customImages.length})
			</span>
			{#if data.proxmoxIsos?.length}
				<span class="text-[10px] text-gray-500">{data.proxmoxIsos.length} Proxmox ISOs found</span>
			{/if}
		</div>

		{#if filteredCustomImages.length > 0}
			<div class="divide-y divide-gray-800/20">
				{#each filteredCustomImages as image (image.id)}
					<button
						class="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-800/20"
						onclick={() => openDetail(image)}
					>
						<div class="flex min-w-0 items-center gap-2">
							<Disc class="h-2.5 w-2.5 shrink-0 text-gray-500" />
							<span class="truncate text-xs text-gray-200">{image.name}</span>
							<Badge variant="outline" class="text-[7px] {imageTypeClass(image.imageType)}">
								.{image.imageType}
							</Badge>
							<span class="text-[10px] text-gray-500">{image.version}</span>
						</div>
						<span class="text-[10px] text-gray-500">{displayArchitecture(image)}</span>
					</button>
				{/each}
			</div>
		{:else if search.trim()}
			<div class="px-5 py-3 text-center text-[10px] text-gray-500">No matches</div>
		{:else}
			<div class="flex items-center justify-center gap-1.5 py-3 text-gray-500">
				<Disc class="h-3 w-3" />
				<p class="text-[10px]">No imported images</p>
			</div>
		{/if}
	</div>
</div>

<Sheet.Root
	bind:open={sheetOpen}
	onOpenChange={(open) => {
		if (!open) closeDetail();
	}}
>
	<Sheet.Content side="right" class="border-gray-800 bg-gray-900 px-6 py-5 sm:max-w-md">
		{#if selectedImage}
			<Sheet.Header class="border-b border-gray-800 pb-4">
				<div class="flex items-start gap-4">
					<div
						class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-gray-800 bg-gray-950/40 p-3"
						style:box-shadow={`inset 0 0 0 1px ${imageAccent(selectedImage)}33`}
					>
						{#if logoSrc(selectedImage)}
							<img src={logoSrc(selectedImage) ?? ''} alt="" class="h-full w-full object-contain" />
						{:else}
							<Disc class="h-10 w-10 text-gray-300" />
						{/if}
					</div>
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<Sheet.Title class="text-base">{selectedImage.name}</Sheet.Title>
							<Badge variant="outline" class="text-[9px] {imageTypeClass(selectedImage.imageType)}">
								{selectedImage.imageType.toUpperCase()}
							</Badge>
						</div>
						<Sheet.Description class="mt-1 text-xs leading-relaxed">
							{selectedImage.description}
						</Sheet.Description>
					</div>
				</div>
			</Sheet.Header>

			<div class="flex-1 overflow-auto py-4">
				<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
					Image Details
				</span>
				<div class="mt-3 divide-y divide-gray-800/30 border-y border-gray-800/30">
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-gray-500">Name</span>
						<span class="text-sm font-medium text-gray-100">{selectedImage.name}</span>
					</div>
					<div class="flex items-start justify-between gap-4 py-3">
						<span class="text-xs text-gray-500">Description</span>
						<span class="max-w-56 text-right text-xs leading-relaxed text-gray-300">
							{selectedImage.description}
						</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-gray-500">Version</span>
						<span class="text-sm font-medium text-gray-100">{selectedImage.version}</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-gray-500">Architecture</span>
						<span class="border border-gray-700 px-1.5 py-0.5 font-mono text-[9px] text-gray-400">
							{displayArchitecture(selectedImage)}
						</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-gray-500">Image Type</span>
						<Badge variant="outline" class="text-[8px] {imageTypeClass(selectedImage.imageType)}">
							{selectedImage.imageType.toUpperCase()}
						</Badge>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-gray-500">Accent</span>
						<div class="flex items-center gap-2">
							<span
								class="h-3 w-3 rounded-full border border-gray-700"
								style:background-color={imageAccent(selectedImage)}
							></span>
							<span class="font-mono text-[10px] text-gray-500">{imageAccent(selectedImage)}</span>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
