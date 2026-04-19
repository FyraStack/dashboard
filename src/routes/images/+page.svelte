<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import {
		createImage as createProjectImage,
		deleteImage as deleteProjectImage
	} from '$lib/remote/images.remote';
	import {
		officialImages,
		imageTypeColors,
		type OfficialImage,
		type ImageType
	} from '$lib/data/images';
	import {
		Disc,
		Upload,
		Trash2,
		Search,
		DollarSign,
		ChevronLeft,
		ChevronRight
	} from '@lucide/svelte';

	type PageData = {
		images?: DbImage[];
		proxmoxIsos?: ProxmoxIso[];
	};

	type DbImage = {
		id: string;
		name: string;
		version: string;
		shortName: string;
		description: string;
		color: string;
		icon: string | null;
		filePath: string;
		isa: string;
	};

	type ProxmoxIso = {
		volid: string;
		filename: string;
		size: number;
		node: string;
	};

	type UserImage = {
		id: string;
		name: string;
		type: ImageType;
		size: string;
		uploaded: string;
		status: 'ready';
		progress: number;
		filePath: string;
		shortName: string;
		description: string;
		icon: string | null;
		color: string;
		isa: string;
	};

	let { data }: { data: PageData } = $props();

	// Carousel pagination
	const perPage = 9;
	let page = $state(0);
	let totalPages = $derived(Math.ceil(filteredOfficialList().length / perPage));

	function filteredOfficialList() {
		if (!search.trim()) return officialImages;
		const q = search.toLowerCase();
		return officialImages.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.versions.some((v) => v.version.toLowerCase().includes(q))
		);
	}

	let pagedImages = $derived(() => {
		const list = filteredOfficialList();
		return list.slice(page * perPage, (page + 1) * perPage);
	});

	// Detail view (inline, replaces grid)
	let selectedImage = $state<OfficialImage | null>(null);

	function openDetail(img: OfficialImage) {
		selectedImage = img;
		sheetOpen = true;
	}

	let sheetOpen = $state(false);

	function closeDetail() {
		sheetOpen = false;
		setTimeout(() => (selectedImage = null), 200);
	}

	let userImages = $state<UserImage[]>([]);

	let search = $state('');

	let filteredUser = $derived(() => {
		if (!search.trim()) return userImages;
		const q = search.toLowerCase();
		return userImages.filter((i) => i.name.toLowerCase().includes(q));
	});

	// Upload
	let uploadOpen = $state(false);
	let uploadName = $state('');
	let uploadFile = $state('');
	let uploadDetectedType = $state<ImageType | null>(null);
	let uploadUrl = $state('');
	let uploadMethod = $state<'file' | 'url'>('file');
	let uploadError = $state('');

	$effect(() => {
		const mapped = (data.images ?? []).map((image) => ({
			id: image.id,
			name: image.name,
			type: detectType(image.filePath) ?? 'img',
			size: 'Unknown',
			uploaded: '—',
			status: 'ready' as const,
			progress: 100,
			filePath: image.filePath,
			shortName: image.shortName,
			description: image.description,
			icon: image.icon,
			color: image.color,
			isa: image.isa
		}));
		userImages = mapped;
	});

	function detectType(filename: string): ImageType | null {
		const ext = filename.split('.').pop()?.toLowerCase();
		if (ext === 'iso') return 'iso';
		if (ext === 'img') return 'img';
		if (ext === 'qcow2') return 'qcow2';
		return null;
	}

	function handleFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		uploadFile = f.name;
		uploadDetectedType = detectType(f.name);
		if (!uploadName) uploadName = f.name.replace(/\.[^.]+$/, '');
	}

	function handleUrlChange() {
		if (uploadUrl) {
			uploadDetectedType = detectType(uploadUrl.split('/').pop() ?? '');
		}
	}

	async function startUpload() {
		if (!uploadName.trim()) return;
		uploadError = '';
		const type = uploadDetectedType ?? 'img';
		const source = uploadMethod === 'url' ? uploadUrl.trim() : uploadFile.trim();
		if (!source) {
			uploadError = 'Choose a file or provide an image URL.';
			return;
		}

		const matchedIso = (data.proxmoxIsos ?? []).find((iso) =>
			uploadMethod === 'url'
				? iso.filename.toLowerCase() === source.split('/').pop()?.toLowerCase()
				: iso.filename.toLowerCase() === source.toLowerCase()
		);
		const filePath = matchedIso?.volid ?? source;
		const versionMatch = uploadName.trim().match(/(\d+(?:\.\d+)?(?:\s*[A-Za-z0-9._-]+)?)/);

		try {
			const created = await createProjectImage({
				name: uploadName.trim(),
				version: versionMatch?.[1]?.trim() ?? 'latest',
				description:
					uploadMethod === 'url' ? `Imported from ${uploadUrl.trim()}` : `Imported from ${source}`,
				shortName: uploadName.trim().slice(0, 2),
				icon: null,
				color: 'bg-gray-600',
				filePath,
				isa: 'x86'
			});
			userImages = [
				...userImages,
				{
					id: created.id,
					name: uploadName.trim(),
					type,
					size: matchedIso
						? `${Math.round(matchedIso.size / (1024 * 1024 * 1024)) || 1} GB`
						: 'Unknown',
					uploaded: new Date().toISOString().slice(0, 10),
					status: 'ready',
					progress: 100,
					filePath,
					shortName: uploadName.trim().slice(0, 2),
					description:
						uploadMethod === 'url'
							? `Imported from ${uploadUrl.trim()}`
							: `Imported from ${source}`,
					icon: null,
					color: 'bg-gray-600',
					isa: 'x86'
				}
			];
			uploadOpen = false;
			uploadName = '';
			uploadFile = '';
			uploadUrl = '';
			uploadDetectedType = null;
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Failed to create image.';
		}
	}

	async function deleteImage(id: string) {
		uploadError = '';
		try {
			await deleteProjectImage({ imageId: id });
			userImages = userImages.filter((i) => i.id !== id);
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Failed to delete image.';
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-fyra-gray-800 px-5">
		<div class="flex items-center gap-2">
			<Disc class="h-4 w-4 text-fyra-gray-400" />
			<span class="text-sm font-semibold text-fyra-gray-100">Images</span>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-fyra-gray-500"
				/>
				<input
					bind:value={search}
					placeholder="Search images..."
					class="h-7 w-44 border border-fyra-gray-700 bg-fyra-gray-800 pr-2 pl-7 text-xs text-fyra-gray-100 placeholder:text-fyra-gray-600 focus:border-fyra-gray-500 focus:outline-none"
				/>
			</div>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 px-3 text-xs"
				onclick={() => {
					uploadOpen = true;
					uploadMethod = 'file';
					uploadFile = '';
					uploadUrl = '';
					uploadName = '';
					uploadDetectedType = null;
				}}
			>
				<Upload class="h-3 w-3" />
				Upload Image
			</Button>
		</div>
	</div>
	{#if uploadError}
		<div
			class="border-fyra-red-900/40 border-b bg-fyra-red-950/20 px-5 py-2 text-xs text-fyra-red-400"
		>
			{uploadError}
		</div>
	{/if}

	<div class="flex-1 overflow-auto">
		<!-- Official Images -->
		<div class="flex items-center justify-between border-b border-fyra-gray-800 px-5 py-3">
			<span class="text-xs font-semibold tracking-wider text-fyra-gray-500 uppercase"
				>Official Images</span
			>
			{#if totalPages > 1 && !selectedImage}
				<div class="flex items-center gap-1.5">
					<button
						class="flex h-6 w-6 items-center justify-center text-fyra-gray-500 transition-colors hover:text-fyra-gray-300 disabled:opacity-30"
						disabled={page === 0}
						onclick={() => page--}
					>
						<ChevronLeft class="h-3.5 w-3.5" />
					</button>
					<span class="text-[10px] text-fyra-gray-500">{page + 1}/{totalPages}</span>
					<button
						class="flex h-6 w-6 items-center justify-center text-fyra-gray-500 transition-colors hover:text-fyra-gray-300 disabled:opacity-30"
						disabled={page >= totalPages - 1}
						onclick={() => page++}
					>
						<ChevronRight class="h-3.5 w-3.5" />
					</button>
				</div>
			{/if}
		</div>

		<div class="border-b border-fyra-gray-800">
			<!-- Card grid -->
			<div class="grid grid-cols-3 gap-px bg-fyra-gray-900">
				{#each pagedImages() as img (img.id)}
					<button
						class="relative flex gap-4 overflow-hidden bg-fyra-gray-900 p-5 text-left transition-colors hover:bg-fyra-gray-800/40"
						onclick={() => openDetail(img)}
					>
						<!-- Brand color mist -->
						<div
							class="pointer-events-none absolute inset-0 opacity-[0.05]"
							style="background: linear-gradient(135deg, {img.iconColor} 0%, transparent 60%)"
						></div>
						<div class="relative">
							{#if img.icon}
								<svg viewBox="0 0 24 24" class="h-12 w-12" fill="var(--fyra-gray-300)"
									><path d={img.icon} /></svg
								>
							{:else}
								<span
									class="flex h-12 w-12 items-center justify-center text-xl font-bold text-fyra-gray-300"
									>{img.shortName}</span
								>
							{/if}
						</div>
						<div class="relative flex min-w-0 flex-1 flex-col">
							<div class="flex items-center gap-1.5">
								<span class="text-sm font-semibold text-fyra-gray-50">{img.name}</span>
								{#if img.paid}
									<Badge
										variant="outline"
										class="border-fyra-red-700 bg-fyra-red-950/40 text-[8px] text-fyra-red-400"
									>
										<DollarSign class="mr-0.5 h-2 w-2" />
										{img.price}
									</Badge>
								{/if}
							</div>
							<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-fyra-gray-500">
								{img.description}
							</p>
							<p class="mt-auto pt-2 text-[10px] leading-none text-fyra-gray-600">
								{img.versions[0].archs.join('  ')} | {img.versions.length} version{img.versions
									.length > 1
									? 's'
									: ''}
							</p>
						</div>
					</button>
				{/each}
			</div>
			{#if filteredOfficialList().length === 0 && search.trim()}
				<div class="px-5 py-8 text-center text-xs text-fyra-gray-500">
					No official images match "{search}"
				</div>
			{/if}
		</div>

		<!-- User Uploaded Images (compact, pinned to bottom) -->
		<div class="flex items-center justify-between border-b border-fyra-gray-800 px-5 py-2.5">
			<span class="text-xs font-semibold tracking-wider text-fyra-gray-500 uppercase">
				Your Images ({userImages.length})
			</span>
			{#if data.proxmoxIsos?.length}
				<span class="text-[10px] text-fyra-gray-600"
					>{data.proxmoxIsos.length} Proxmox ISOs found</span
				>
			{/if}
		</div>

		{#if filteredUser().length > 0}
			<div class="divide-y divide-fyra-gray-800/20">
				{#each filteredUser() as img (img.id)}
					<div
						class="flex items-center justify-between px-5 py-4 transition-colors hover:bg-fyra-gray-800/20"
					>
						<div class="flex items-center gap-2">
							<Disc class="h-2.5 w-2.5 shrink-0 text-fyra-gray-600" />
							<span class="text-xs text-fyra-gray-200">{img.name}</span>
							<Badge variant="outline" class="text-[7px] {imageTypeColors[img.type]}"
								>.{img.type}</Badge
							>
							<span class="text-[10px] text-fyra-gray-600">{img.size}</span>
						</div>
						<div class="flex items-center gap-1.5">
							<span class="text-[10px] text-fyra-gray-600">{img.uploaded}</span>
							<Button
								variant="ghost"
								size="sm"
								class="h-5 w-5 p-0 text-fyra-gray-600 hover:text-fyra-red-400"
								onclick={() => deleteImage(img.id)}
							>
								<Trash2 class="h-2.5 w-2.5" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{:else if search.trim()}
			<div class="px-5 py-3 text-center text-[10px] text-fyra-gray-600">No matches</div>
		{:else}
			<div class="flex items-center justify-center gap-1.5 py-3 text-fyra-gray-600">
				<Upload class="h-3 w-3" />
				<p class="text-[10px]">No uploaded images</p>
			</div>
		{/if}
	</div>
</div>

<!-- Image Detail Sheet -->
<Sheet.Root
	bind:open={sheetOpen}
	onOpenChange={(v) => {
		if (!v) closeDetail();
	}}
>
	<Sheet.Content side="right" class="border-fyra-gray-800 bg-fyra-gray-900 px-6 py-5 sm:max-w-md">
		{#if selectedImage}
			<Sheet.Header class="border-b border-fyra-gray-800 pb-4">
				<div class="flex items-start gap-4">
					<div class="shrink-0">
						{#if selectedImage.icon}
							<svg viewBox="0 0 24 24" class="h-14 w-14" fill="var(--fyra-gray-300)"
								><path d={selectedImage.icon} /></svg
							>
						{:else}
							<span
								class="flex h-14 w-14 items-center justify-center text-2xl font-bold text-fyra-gray-300"
								>{selectedImage.shortName}</span
							>
						{/if}
					</div>
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<Sheet.Title class="text-base">{selectedImage.name}</Sheet.Title>
							{#if selectedImage.paid}
								<Badge
									variant="outline"
									class="border-fyra-red-700 bg-fyra-red-950/40 text-[9px] text-fyra-red-400"
								>
									<DollarSign class="mr-0.5 h-2 w-2" />
									{selectedImage.price}
								</Badge>
							{/if}
						</div>
						<Sheet.Description class="mt-1 text-xs leading-relaxed"
							>{selectedImage.description}</Sheet.Description
						>
					</div>
				</div>
			</Sheet.Header>

			<div class="flex-1 overflow-auto py-4">
				<span class="text-[10px] font-semibold tracking-wider text-fyra-gray-500 uppercase"
					>Available Versions</span
				>
				<div class="mt-3 divide-y divide-fyra-gray-800/30">
					{#each selectedImage.versions as ver (ver.version)}
						<div class="flex items-center justify-between py-3">
							<div class="flex items-center gap-3">
								<span class="text-sm font-medium text-fyra-gray-100">{ver.version}</span>
								<div class="flex gap-1">
									{#each ver.archs as arch (arch)}
										<span
											class="border border-fyra-gray-700 px-1.5 py-0.5 font-mono text-[9px] text-fyra-gray-400"
											>{arch}</span
										>
									{/each}
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Badge variant="outline" class="text-[8px] {imageTypeColors[ver.type]}"
									>{ver.type.toUpperCase()}</Badge
								>
								<span class="text-[10px] text-fyra-gray-500">{ver.size}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<!-- Upload Image Dialog -->
<Dialog.Root bind:open={uploadOpen}>
	<Dialog.Content class="border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Upload Image</Dialog.Title>
			<Dialog.Description
				>Upload a .iso, .img, or .qcow2 file to use with your servers.</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Image Name</Label>
				<Input bind:value={uploadName} placeholder="my-custom-image" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Source</Label>
				<div class="flex gap-2">
					<button
						class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {uploadMethod ===
						'file'
							? 'border-fyra-red-500 bg-fyra-red-950/20 text-fyra-gray-100'
							: 'border-fyra-gray-700 text-fyra-gray-400 hover:border-fyra-gray-600'}"
						onclick={() => (uploadMethod = 'file')}>File Upload</button
					>
					<button
						class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {uploadMethod ===
						'url'
							? 'border-fyra-red-500 bg-fyra-red-950/20 text-fyra-gray-100'
							: 'border-fyra-gray-700 text-fyra-gray-400 hover:border-fyra-gray-600'}"
						onclick={() => (uploadMethod = 'url')}>URL Import</button
					>
				</div>
			</div>
			{#if uploadMethod === 'file'}
				<label
					class="flex cursor-pointer flex-col items-center justify-center border border-dashed border-fyra-gray-600 bg-fyra-gray-800/30 px-4 py-6 text-center transition-colors hover:border-fyra-gray-500 hover:bg-fyra-gray-800/50"
				>
					<Upload class="mb-2 h-6 w-6 text-fyra-gray-500" />
					{#if uploadFile}
						<span class="text-xs font-medium text-fyra-gray-200">{uploadFile}</span>
						{#if uploadDetectedType}
							<span class="mt-1 text-[10px] text-fyra-gray-500"
								>Detected: .{uploadDetectedType}</span
							>
						{/if}
					{:else}
						<span class="text-xs text-fyra-gray-400"
							>Drop or click to browse (.iso, .img, .qcow2)</span
						>
					{/if}
					<input type="file" accept=".iso,.img,.qcow2" class="hidden" onchange={handleFileSelect} />
				</label>
			{:else}
				<div class="flex flex-col gap-2">
					<Label>Image URL</Label>
					<Input
						bind:value={uploadUrl}
						placeholder="https://example.com/image.iso"
						oninput={handleUrlChange}
					/>
					{#if uploadDetectedType}
						<p class="text-xs text-fyra-gray-500">Detected: .{uploadDetectedType}</p>
					{:else if uploadUrl}
						<p class="text-xs text-amber-500">Could not detect format. Will default to .img</p>
					{/if}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (uploadOpen = false)}>Cancel</Button>
			<Button
				size="sm"
				onclick={startUpload}
				disabled={!uploadName.trim() && !uploadFile && !uploadUrl}
			>
				<Upload class="h-3 w-3" />
				Upload
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
