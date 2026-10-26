<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ImportImageDialog, {
		type ImportImageRequest
	} from '#lib/components/dialogs/import-image-dialog.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { confirmDestructive } from '#lib/confirm.svelte.js';
	import { imageTypeColors } from '#lib/data/images.js';
	import { deleteCustomImage, importCustomImage } from '#lib/remote/custom-images.remote.js';
	import { formatBytes, getErrorMessage } from '#lib/utils.js';
	import { invalidate } from '$app/navigation';
	import { page as appPage } from '$app/state';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Download from '~icons/lucide/download';
	import Disc from '~icons/nucleo/disc';
	import Search from '~icons/nucleo/search';
	import Trash2 from '~icons/nucleo/trash';

	type ImageStatus = 'importing' | 'ready' | 'failed';

	interface PlatformImage {
		accentColor: string;
		description: string;
		id: string;
		imageType: string;
		isa: string;
		isOfficial: boolean;
		logoSvg: string | null | undefined;
		name: string;
		version: string;
	}

	interface CustomImage {
		createdAt: number;
		description: string;
		id: string;
		imageType: string;
		isa: string;
		name: string;
		secureBoot: boolean;
		sizeBytes: number | null;
		sourceUrl: string | null;
		status: ImageStatus;
		statusError: string | null;
		version: string;
		virtualSizeBytes: number | null;
	}

	interface PageData {
		customImages: CustomImage[];
		importsEnabled: boolean;
		limits: { maxImageBytes: number; maxImagesPerProject: number; maxProjectBytes: number };
		platformImages: PlatformImage[];
		usage: { bytes: number; count: number };
	}

	type SelectedImage =
		| { kind: 'platform'; image: PlatformImage }
		| { kind: 'custom'; image: CustomImage };

	let { data }: { data: PageData } = $props();

	const perPage = 9;
	let page = $state(0);
	let search = $state('');
	let sheetOpen = $state(false);
	let selected = $state<SelectedImage | null>(null);
	let importDialogOpen = $state(false);
	let deletingIds = $state<string[]>([]);

	const projectId = $derived(appPage.params.projectid ?? '');
	const platformImages = $derived(data.platformImages ?? []);
	const officialImages = $derived(platformImages.filter((image) => image.isOfficial));
	const otherPlatformImages = $derived(platformImages.filter((image) => !image.isOfficial));
	const customImages = $derived(data.customImages ?? []);
	const atImageLimit = $derived(data.usage.count >= data.limits.maxImagesPerProject);

	function matches(image: { name: string; version: string; imageType: string }) {
		const q = search.trim().toLowerCase();
		return (
			!q ||
			image.name.toLowerCase().includes(q) ||
			image.version.toLowerCase().includes(q) ||
			image.imageType.toLowerCase().includes(q)
		);
	}

	let filteredOfficialImages = $derived(officialImages.filter(matches));
	let filteredOtherPlatformImages = $derived(otherPlatformImages.filter(matches));
	let filteredCustomImages = $derived(customImages.filter(matches));

	let totalPages = $derived(Math.ceil(filteredOfficialImages.length / perPage));
	let pagedImages = $derived(filteredOfficialImages.slice(page * perPage, (page + 1) * perPage));

	// Poll while the cluster is importing something.
	const hasPendingImports = $derived(customImages.some((image) => image.status === 'importing'));
	$effect(() => {
		if (!hasPendingImports) {
			return;
		}
		const interval = setInterval(() => invalidate('project:images'), 5000);
		return () => clearInterval(interval);
	});

	async function startImport(request: ImportImageRequest) {
		await importCustomImage({ projectId, ...request });
		toast.success(`Importing ${request.name}. It will be ready in a few minutes.`);
		await invalidate('project:images');
	}

	async function removeCustomImage(image: CustomImage) {
		if (deletingIds.includes(image.id)) {
			return;
		}
		const ok = await confirmDestructive({
			title: 'Delete image',
			description: `This permanently deletes ${image.name}. Servers already created from it are not affected.`,
			confirmWord: image.name,
			confirmLabel: 'Delete image'
		});
		if (!ok) {
			return;
		}
		deletingIds = [...deletingIds, image.id];
		try {
			await deleteCustomImage({ imageId: image.id });
			if (selected?.kind === 'custom' && selected.image.id === image.id) {
				closeDetail();
			}
			await invalidate('project:images');
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete image'));
		} finally {
			deletingIds = deletingIds.filter((id) => id !== image.id);
		}
	}

	function openDetail(next: SelectedImage) {
		selected = next;
		sheetOpen = true;
	}

	function closeDetail() {
		sheetOpen = false;
		setTimeout(() => (selected = null), 200);
	}

	function imageTypeClass(imageType: string) {
		return imageTypeColors[imageType] ?? 'border-border bg-muted/60 text-muted-foreground';
	}

	function imageAccent(image: PlatformImage) {
		return image.accentColor || '#6b7280';
	}

	function logoSrc(image: PlatformImage) {
		return image.logoSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(image.logoSvg)}` : null;
	}

	function displayArchitecture(image: { isa: string }) {
		return image.isa || 'x86';
	}

	const statusLabels: Record<ImageStatus, string> = {
		importing: 'Importing',
		ready: 'Ready',
		failed: 'Failed'
	};
	const statusClasses: Record<ImageStatus, string> = {
		importing: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400',
		ready: 'border-green-300 text-green-700 dark:border-green-800 dark:text-green-400',
		failed: 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400'
	};
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-5">
		<div class="flex items-center gap-2">
			<Disc class="h-4 w-4 text-muted-foreground" />
			<span class="text-sm font-semibold text-foreground">Images</span>
		</div>
		<div class="flex items-center gap-2">
			{#if data.importsEnabled}
				<Button
					size="sm"
					class="h-7 gap-1.5 text-xs"
					disabled={atImageLimit}
					title={atImageLimit
						? `Projects can have at most ${data.limits.maxImagesPerProject} images`
						: undefined}
					onclick={() => (importDialogOpen = true)}
				>
					<Download class="h-3 w-3" />
					Import Image
				</Button>
			{/if}
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-muted-foreground"
				/>
				<input
					bind:value={search}
					placeholder="Search images..."
					class="h-7 w-44 border border-border bg-muted pr-2 pl-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
				/>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		<div class="flex items-center justify-between border-b border-border px-5 py-3">
			<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
				>Official Images</span
			>
			{#if totalPages > 1 && !selected}
				<div class="flex items-center gap-1.5">
					<button
						type="button"
						aria-label="Previous page"
						class="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
						disabled={page === 0}
						onclick={() => (page -= 1)}
					>
						<ChevronLeft class="h-3.5 w-3.5" />
					</button>
					<span class="text-[10px] text-muted-foreground">{page + 1}/{totalPages}</span>
					<button
						type="button"
						aria-label="Next page"
						class="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
						disabled={page >= totalPages - 1}
						onclick={() => (page += 1)}
					>
						<ChevronRight class="h-3.5 w-3.5" />
					</button>
				</div>
			{/if}
		</div>

		<div class="border-b border-border">
			<div class="grid grid-cols-3 gap-px bg-background">
				{#each pagedImages as image (image.id)}
					<button
						type="button"
						class="relative flex gap-4 overflow-hidden bg-background p-5 text-left transition-colors hover:bg-muted/40"
						onclick={() => openDetail({ kind: 'platform', image })}
					>
						<div
							class="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
							style:background={`radial-gradient(120% 120% at 0% 0%, ${imageAccent(image)} 0%, transparent 55%)`}
						></div>
						<div
							class="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-background/40 p-2"
						>
							{#if logoSrc(image)}
								<img src={logoSrc(image) ?? ''} alt="" class="h-full w-full object-contain" />
							{:else}
								<Disc class="h-8 w-8 text-muted-foreground" />
							{/if}
						</div>
						<div class="relative flex min-w-0 flex-1 flex-col">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-sm font-semibold text-foreground">{image.name}</span>
								<Badge variant="outline" class="text-[8px] {imageTypeClass(image.imageType)}">
									{image.imageType.toUpperCase()}
								</Badge>
							</div>
							<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
								{image.description}
							</p>
							<p class="mt-auto pt-2 text-[10px] leading-none text-muted-foreground">
								{displayArchitecture(image)}
								| {image.version}
							</p>
						</div>
					</button>
				{/each}
			</div>
			{#if filteredOfficialImages.length === 0 && search.trim()}
				<div class="px-5 py-8 text-center text-xs text-muted-foreground">
					No official images match "{search}"
				</div>
			{/if}
		</div>

		{#if filteredOtherPlatformImages.length > 0}
			<div class="border-b border-border px-5 py-2.5">
				<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
					Other Images
				</span>
			</div>
			<div class="divide-y divide-border/20 border-b border-border">
				{#each filteredOtherPlatformImages as image (image.id)}
					<button
						type="button"
						class="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/20"
						onclick={() => openDetail({ kind: 'platform', image })}
					>
						<div class="flex min-w-0 items-center gap-2">
							<Disc class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
							<span class="truncate text-xs text-foreground">{image.name}</span>
							<Badge variant="outline" class="text-[7px] {imageTypeClass(image.imageType)}">
								.{image.imageType}
							</Badge>
							<span class="text-[10px] text-muted-foreground">{image.version}</span>
						</div>
						<span class="text-[10px] text-muted-foreground">{displayArchitecture(image)}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex items-center justify-between border-b border-border px-5 py-2.5">
			<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
				Project Images ({data.usage.count}/{data.limits.maxImagesPerProject})
			</span>
			<span class="text-[10px] text-muted-foreground">
				{formatBytes(data.usage.bytes)}
				of {formatBytes(data.limits.maxProjectBytes)} used
			</span>
		</div>

		{#if filteredCustomImages.length > 0}
			<div class="divide-y divide-border/20">
				{#each filteredCustomImages as image (image.id)}
					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/20"
						onclick={() => openDetail({ kind: 'custom', image })}
					>
						<div class="flex min-w-0 items-center gap-2">
							<Disc class="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
							<span class="truncate text-xs text-foreground">{image.name}</span>
							{#if image.status === 'ready'}
								<Badge variant="outline" class="text-[7px] {imageTypeClass(image.imageType)}">
									.{image.imageType}
								</Badge>
							{/if}
							<Badge variant="outline" class="text-[8px] {statusClasses[image.status]}">
								{statusLabels[image.status]}
							</Badge>
							{#if image.version}
								<span class="text-[10px] text-muted-foreground">{image.version}</span>
							{/if}
						</div>
						<div class="flex min-w-0 items-center gap-3">
							{#if image.status === 'failed' && image.statusError}
								<span class="max-w-72 truncate text-[10px] text-red-500">{image.statusError}</span>
							{/if}
							<span class="shrink-0 text-[10px] text-muted-foreground">
								{image.sizeBytes ? formatBytes(image.sizeBytes) : ''}
							</span>
						</div>
					</button>
				{/each}
			</div>
		{:else if search.trim()}
			<div class="px-5 py-3 text-center text-[10px] text-muted-foreground">No matches</div>
		{:else}
			<div class="flex flex-col items-center justify-center gap-1.5 py-6 text-muted-foreground">
				<Disc class="h-4 w-4" />
				<p class="text-[11px]">No project images yet</p>
				<p class="max-w-sm text-center text-[10px]">
					Import a qcow2 image from a URL to boot servers from your own OS build. Images are private
					to this project.
				</p>
			</div>
		{/if}
	</div>
</div>

<ImportImageDialog
	bind:open={importDialogOpen}
	maxImageBytes={data.limits.maxImageBytes}
	onSubmit={startImport}
/>

<Sheet.Root
	bind:open={sheetOpen}
	onOpenChange={(open) => {
		if (!open) {
			closeDetail();
		}
	}}
>
	<Sheet.Content side="right" class="border-border bg-background px-6 py-5 sm:max-w-md">
		{#if selected?.kind === 'platform'}
			{@const selectedImage = selected.image}
			<Sheet.Header class="border-b border-border pb-4">
				<div class="flex items-start gap-4">
					<div
						class="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-background/40 p-3"
						style:box-shadow={`inset 0 0 0 1px ${imageAccent(selectedImage)}33`}
					>
						{#if logoSrc(selectedImage)}
							<img src={logoSrc(selectedImage) ?? ''} alt="" class="h-full w-full object-contain" />
						{:else}
							<Disc class="h-10 w-10 text-muted-foreground" />
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
				<span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
					Image Details
				</span>
				<div class="mt-3 divide-y divide-border/30 border-y border-border/30">
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Name</span>
						<span class="text-sm font-medium text-foreground">{selectedImage.name}</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Version</span>
						<span class="text-sm font-medium text-foreground">{selectedImage.version}</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Architecture</span>
						<span
							class="border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
						>
							{displayArchitecture(selectedImage)}
						</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Image Type</span>
						<Badge variant="outline" class="text-[8px] {imageTypeClass(selectedImage.imageType)}">
							{selectedImage.imageType.toUpperCase()}
						</Badge>
					</div>
				</div>
			</div>
		{:else if selected?.kind === 'custom'}
			{@const selectedImage = selected.image}
			<Sheet.Header class="border-b border-border pb-4">
				<div class="flex items-center gap-2">
					<Sheet.Title class="text-base">{selectedImage.name}</Sheet.Title>
					<Badge variant="outline" class="text-[9px] {statusClasses[selectedImage.status]}">
						{statusLabels[selectedImage.status]}
					</Badge>
				</div>
				<Sheet.Description class="mt-1 text-xs leading-relaxed">
					{selectedImage.description || 'Project image'}
				</Sheet.Description>
			</Sheet.Header>

			<div class="flex-1 overflow-auto py-4">
				{#if selectedImage.status === 'failed' && selectedImage.statusError}
					<div
						class="mb-4 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
					>
						{selectedImage.statusError}
					</div>
				{:else if selectedImage.status === 'importing'}
					<div class="mb-4 border border-border px-3 py-2 text-xs text-muted-foreground">
						The cluster is importing this image. It will be available for new servers when it's
						ready.
					</div>
				{/if}
				<span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
					Image Details
				</span>
				<div class="mt-3 divide-y divide-border/30 border-y border-border/30">
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Version</span>
						<span class="text-sm font-medium text-foreground">{selectedImage.version || '-'}</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Format</span>
						{#if selectedImage.status !== 'failed'}
							<Badge variant="outline" class="text-[8px] {imageTypeClass(selectedImage.imageType)}">
								{selectedImage.imageType.toUpperCase()}
							</Badge>
						{:else}
							<span class="text-sm text-muted-foreground">-</span>
						{/if}
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">File Size</span>
						<span class="text-sm font-medium text-foreground">
							{selectedImage.sizeBytes ? formatBytes(selectedImage.sizeBytes) : '-'}
						</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Disk Size</span>
						<span class="text-sm font-medium text-foreground">
							{selectedImage.virtualSizeBytes ? formatBytes(selectedImage.virtualSizeBytes) : '-'}
						</span>
					</div>
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Secure Boot</span>
						<span class="text-sm font-medium text-foreground">
							{selectedImage.secureBoot ? 'Enabled' : 'Disabled'}
						</span>
					</div>
					{#if selectedImage.sourceUrl}
						<div class="flex items-start justify-between gap-4 py-3">
							<span class="shrink-0 text-xs text-muted-foreground">Source</span>
							<span
								class="min-w-0 text-right font-mono text-[10px] break-all text-muted-foreground"
							>
								{selectedImage.sourceUrl}
							</span>
						</div>
					{/if}
					<div class="flex items-center justify-between py-3">
						<span class="text-xs text-muted-foreground">Imported</span>
						<span class="text-sm font-medium text-foreground">
							{new Date(selectedImage.createdAt).toLocaleString()}
						</span>
					</div>
				</div>
				<Button
					variant="destructive"
					size="sm"
					class="mt-6 gap-1.5"
					disabled={deletingIds.includes(selectedImage.id)}
					onclick={() => removeCustomImage(selectedImage)}
				>
					<Trash2 class="h-3.5 w-3.5" />
					{deletingIds.includes(selectedImage.id) ? 'Deleting...' : 'Delete Image'}
				</Button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
