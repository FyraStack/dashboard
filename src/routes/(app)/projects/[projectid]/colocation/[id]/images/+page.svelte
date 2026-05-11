<script lang="ts">
	import Icon from '$lib/components/icon.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Sheet from '$lib/components/ui/sheet';
	import {
		imageTypeColors,
		officialImages,
		type ImageType,
		type OfficialImage
	} from '$lib/data/images';
	import {
		ChevronLeft,
		ChevronRight,
		Disc,
		DollarSign,
		Power,
		Search,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import { getColocationContext } from '../../colocation-context.svelte';

	type UserImage = {
		id: string;
		name: string;
		type: ImageType;
		size: string;
		uploaded: string;
		status: 'ready' | 'uploading' | 'processing';
		progress: number;
	};

	const colo = getColocationContext();
	let userImages = $state<UserImage[]>([
		{
			id: 'img-008',
			name: 'custom-webserver',
			type: 'img',
			size: '8.4 GB',
			uploaded: '2026-03-28',
			status: 'ready',
			progress: 100
		}
	]);
	let search = $state('');
	let imagePage = $state(0);
	let selectedImage = $state<OfficialImage | null>(null);
	let sheetOpen = $state(false);
	let mountedImage = $state<string | null>(null);
	let bootingFromImage = $state(false);
	let uploadOpen = $state(false);
	let uploadName = $state('');
	let uploadFile = $state('');
	let uploadDetectedType = $state<ImageType | null>(null);
	let uploadUrl = $state('');
	let uploadMethod = $state<'file' | 'url'>('file');
	let imageCounter = $state(10);
	const imagesPerPage = 6;

	let filteredOfficialImages = $derived.by(() => {
		if (!search.trim()) return officialImages;
		const q = search.toLowerCase();
		return officialImages.filter(
			(image) =>
				image.name.toLowerCase().includes(q) ||
				image.versions.some((version) => version.version.toLowerCase().includes(q))
		);
	});
	let imageTotalPages = $derived(Math.ceil(filteredOfficialImages.length / imagesPerPage));
	let pagedOfficialImages = $derived(
		filteredOfficialImages.slice(imagePage * imagesPerPage, (imagePage + 1) * imagesPerPage)
	);
	let filteredUserImages = $derived.by(() => {
		if (!search.trim()) return userImages;
		const q = search.toLowerCase();
		return userImages.filter((image) => image.name.toLowerCase().includes(q));
	});

	function openImageDetail(image: OfficialImage) {
		selectedImage = image;
		sheetOpen = true;
	}

	function closeImageDetail() {
		sheetOpen = false;
		setTimeout(() => (selectedImage = null), 200);
	}

	function mountOfficialVersion(name: string, version: string) {
		mountedImage = `${name} ${version}`;
	}

	function mountUserImage(name: string) {
		mountedImage = name;
	}

	function bootFromMountedImage() {
		if (!mountedImage) return;
		bootingFromImage = true;
		colo.updateSelectedUnit({ status: 'provisioning' });
		setTimeout(() => {
			colo.updateSelectedUnit({ status: 'online' });
			bootingFromImage = false;
		}, 3000);
	}

	function detectImageType(filename: string): ImageType | null {
		const ext = filename.split('.').pop()?.toLowerCase();
		if (ext === 'iso') return 'iso';
		if (ext === 'img') return 'img';
		if (ext === 'qcow2') return 'qcow2';
		return null;
	}

	function handleFileSelect(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		uploadFile = file.name;
		uploadDetectedType = detectImageType(file.name);
		if (!uploadName) uploadName = file.name.replace(/\.[^.]+$/, '');
	}

	function handleUrlChange() {
		if (uploadUrl) uploadDetectedType = detectImageType(uploadUrl.split('/').pop() ?? '');
	}

	function openUploadDialog() {
		uploadOpen = true;
		uploadMethod = 'file';
		uploadFile = '';
		uploadUrl = '';
		uploadName = '';
		uploadDetectedType = null;
	}

	function startUpload() {
		if (!uploadName.trim()) return;
		imageCounter += 1;
		const sizes = ['1.2 GB', '2.8 GB', '4.5 GB', '680 MB', '9.1 GB'];
		const image: UserImage = {
			id: `img-${String(imageCounter).padStart(3, '0')}`,
			name: uploadName.trim(),
			type: uploadDetectedType ?? 'img',
			size: sizes[Math.floor(Math.random() * sizes.length)],
			uploaded: new Date().toISOString().slice(0, 10),
			status: 'uploading',
			progress: 0
		};
		userImages.push(image);
		uploadOpen = false;
		uploadName = '';
		uploadFile = '';
		uploadUrl = '';
		uploadDetectedType = null;
		const idx = userImages.length - 1;
		const tick = setInterval(() => {
			if (userImages[idx].progress >= 100) {
				userImages[idx].status = 'processing';
				clearInterval(tick);
				setTimeout(() => {
					userImages[idx].status = 'ready';
					userImages[idx].progress = 100;
				}, 1500);
				return;
			}
			userImages[idx].progress = Math.min(
				100,
				userImages[idx].progress + Math.floor(Math.random() * 15 + 5)
			);
		}, 400);
	}

	function deleteImage(id: string) {
		userImages = userImages.filter((image) => image.id !== id);
	}
</script>

{#if colo.selectedUnit}
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if mountedImage}
			<div
				class="flex items-center justify-between border-b border-gray-800 bg-gray-800/20 px-5 py-2.5"
			>
				<div class="flex items-center gap-2">
					<Disc class="h-3 w-3 text-red-400" />
					<span class="text-xs font-medium text-gray-200">Mounted: {mountedImage}</span>
				</div>
				<div class="flex items-center gap-1.5">
					<Button
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 px-3 text-xs"
						disabled={bootingFromImage || colo.selectedUnit.status === 'provisioning'}
						onclick={bootFromMountedImage}
					>
						<Power class="h-3 w-3" />
						{#if bootingFromImage}Booting...{:else}Boot from Image{/if}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-7 px-2 text-xs"
						onclick={() => (mountedImage = null)}>Unmount</Button
					>
				</div>
			</div>
		{:else}
			<div class="border-b border-gray-800 px-5 py-2.5 text-xs text-gray-500">
				No image mounted. Select an image below to mount via IPMI virtual media.
			</div>
		{/if}

		<div class="flex items-center justify-between border-b border-gray-800 px-5 py-2.5">
			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-gray-500"
				/>
				<input
					bind:value={search}
					placeholder="Search images..."
					class="h-7 w-44 border border-gray-700 bg-gray-800 pr-2 pl-7 text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
				/>
			</div>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 px-3 text-xs"
				onclick={openUploadDialog}
			>
				<Upload class="h-3 w-3" /> Upload Image
			</Button>
		</div>

		<div class="flex-1 overflow-auto">
			<div class="flex items-center justify-between border-b border-gray-800 px-5 py-2.5">
				<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
					>Official Images</span
				>
				{#if imageTotalPages > 1}
					<div class="flex items-center gap-1.5">
						<button
							class="flex h-6 w-6 items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30"
							disabled={imagePage === 0}
							onclick={() => (imagePage -= 1)}><ChevronLeft class="h-3.5 w-3.5" /></button
						>
						<span class="text-[10px] text-gray-500">{imagePage + 1}/{imageTotalPages}</span>
						<button
							class="flex h-6 w-6 items-center justify-center text-gray-500 hover:text-gray-300 disabled:opacity-30"
							disabled={imagePage >= imageTotalPages - 1}
							onclick={() => (imagePage += 1)}><ChevronRight class="h-3.5 w-3.5" /></button
						>
					</div>
				{/if}
			</div>
			<div class="border-b border-gray-800">
				<div class="grid grid-cols-2 gap-px bg-gray-900">
					{#each pagedOfficialImages as image (image.id)}
						<button
							class="relative flex gap-3 overflow-hidden bg-gray-900 p-4 text-left transition-colors hover:bg-gray-800/40"
							onclick={() => openImageDetail(image)}
						>
							<div
								class="pointer-events-none absolute inset-0 opacity-[0.05]"
								style:background={`linear-gradient(135deg, ${image.iconColor} 0%, transparent 60%)`}
							></div>
							<div class="relative shrink-0">
								{#if image.icon}<Icon
										name={image.icon}
										class="h-10 w-10 text-gray-300"
									/>{:else}<Disc class="h-10 w-10 text-gray-300" />{/if}
							</div>
							<div class="relative flex min-w-0 flex-1 flex-col">
								<div class="flex items-center gap-1.5">
									<span class="text-sm font-semibold text-gray-50">{image.name}</span>
									{#if image.paid}<Badge
											variant="outline"
											class="border-red-700 bg-red-950/40 text-[8px] text-red-400"
											><DollarSign class="mr-0.5 h-2 w-2" />{image.price}</Badge
										>{/if}
								</div>
								<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-gray-500">
									{image.description}
								</p>
								<p class="mt-auto pt-1.5 text-[10px] leading-none text-gray-600">
									{image.versions[0].archs.join('  ')} | {image.versions.length} version{image
										.versions.length > 1
										? 's'
										: ''}
								</p>
							</div>
						</button>
					{/each}
				</div>
				{#if filteredOfficialImages.length === 0 && search.trim()}
					<div class="px-5 py-6 text-center text-xs text-gray-500">
						No official images match "{search}"
					</div>
				{/if}
			</div>

			<div class="flex items-center justify-between border-b border-gray-800 px-5 py-2.5">
				<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
					>Your Images ({userImages.length})</span
				>
			</div>
			{#if filteredUserImages.length > 0}
				<div class="divide-y divide-gray-800/20">
					{#each filteredUserImages as image (image.id)}
						<div
							class="flex items-center justify-between px-5 py-3 transition-colors hover:bg-gray-800/20"
						>
							<div class="flex items-center gap-2">
								<Disc class="h-2.5 w-2.5 shrink-0 text-gray-600" />
								<span class="text-xs text-gray-200">{image.name}</span>
								<Badge variant="outline" class="text-[7px] {imageTypeColors[image.type]}"
									>.{image.type}</Badge
								>
								<span class="text-[10px] text-gray-600">{image.size}</span>
							</div>
							<div class="flex items-center gap-1.5">
								{#if image.status === 'ready'}
									{#if mountedImage === image.name}
										<Badge
											variant="outline"
											class="border-emerald-800 bg-emerald-950/40 text-[9px] text-emerald-400"
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
									<span class="text-[10px] text-gray-600">{image.uploaded}</span>
								{:else if image.status === 'uploading'}
									<div class="flex items-center gap-1">
										<div class="h-0.5 w-12 bg-gray-800">
											<div
												class="h-full bg-red-500 transition-all"
												style:width={`${image.progress}%`}
											></div>
										</div>
										<span class="text-[9px] text-gray-500">{image.progress}%</span>
									</div>
								{:else}
									<span class="text-[9px] text-amber-500">Processing</span>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									class="h-5 w-5 p-0 text-gray-600 hover:text-red-400"
									onclick={() => deleteImage(image.id)}
									disabled={image.status !== 'ready'}><Trash2 class="h-2.5 w-2.5" /></Button
								>
							</div>
						</div>
					{/each}
				</div>
			{:else if search.trim()}
				<div class="px-5 py-3 text-center text-[10px] text-gray-600">No matches</div>
			{:else}
				<div class="flex items-center justify-center gap-1.5 py-3 text-gray-600">
					<Upload class="h-3 w-3" />
					<p class="text-[10px]">No uploaded images</p>
				</div>
			{/if}
		</div>
	</div>

	<Sheet.Root bind:open={sheetOpen} onOpenChange={(open) => !open && closeImageDetail()}>
		<Sheet.Content side="right" class="border-gray-800 bg-gray-900 px-6 py-5 sm:max-w-md">
			{#if selectedImage}
				<Sheet.Header class="border-b border-gray-800 pb-4">
					<div class="flex items-start gap-4">
						<div class="shrink-0">
							{#if selectedImage.icon}<Icon
									name={selectedImage.icon}
									class="h-14 w-14 text-gray-300"
								/>{:else}<Disc class="h-14 w-14 text-gray-300" />{/if}
						</div>
						<div class="flex-1">
							<div class="flex items-center gap-2">
								<Sheet.Title class="text-base">{selectedImage.name}</Sheet.Title
								>{#if selectedImage.paid}<Badge
										variant="outline"
										class="border-red-700 bg-red-950/40 text-[9px] text-red-400"
										><DollarSign class="mr-0.5 h-2 w-2" />{selectedImage.price}</Badge
									>{/if}
							</div>
							<Sheet.Description class="mt-1 text-xs leading-relaxed"
								>{selectedImage.description}</Sheet.Description
							>
						</div>
					</div>
				</Sheet.Header>
				<div class="flex-1 overflow-auto py-4">
					<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
						>Available Versions</span
					>
					<div class="mt-3 divide-y divide-gray-800/30">
						{#each selectedImage.versions as version (version.version)}
							<div class="flex items-center justify-between py-3">
								<div class="flex items-center gap-3">
									<span class="text-sm font-medium text-gray-100">{version.version}</span>
									<div class="flex gap-1">
										{#each version.archs as arch (arch)}<span
												class="border border-gray-700 px-1.5 py-0.5 font-mono text-[9px] text-gray-400"
												>{arch}</span
											>{/each}
									</div>
								</div>
								<div class="flex items-center gap-2">
									<Badge variant="outline" class="text-[8px] {imageTypeColors[version.type]}"
										>{version.type.toUpperCase()}</Badge
									><span class="text-[10px] text-gray-500">{version.size}</span>
								</div>
							</div>
							<div class="flex items-center gap-2 pb-3">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 gap-1.5 px-3 text-xs"
									onclick={() => mountOfficialVersion(selectedImage!.name, version.version)}
									><Disc class="h-3 w-3" /> Mount via IPMI</Button
								>
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1.5 px-3 text-xs"
									onclick={() => {
										mountOfficialVersion(selectedImage!.name, version.version);
										sheetOpen = false;
										bootFromMountedImage();
									}}><Power class="h-3 w-3" /> Mount & Boot</Button
								>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Root>

	<Dialog.Root bind:open={uploadOpen}>
		<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
			<Dialog.Header
				><Dialog.Title>Upload Image</Dialog.Title><Dialog.Description
					>Upload a .iso or .img file to mount via IPMI virtual media.</Dialog.Description
				></Dialog.Header
			>
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<Label>Image Name</Label><Input bind:value={uploadName} placeholder="my-custom-image" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>Source</Label>
					<div class="flex gap-2">
						<button
							class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {uploadMethod ===
							'file'
								? 'border-red-500 bg-red-950/20 text-gray-100'
								: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
							onclick={() => (uploadMethod = 'file')}>File Upload</button
						><button
							class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {uploadMethod ===
							'url'
								? 'border-red-500 bg-red-950/20 text-gray-100'
								: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
							onclick={() => (uploadMethod = 'url')}>URL Import</button
						>
					</div>
				</div>
				{#if uploadMethod === 'file'}
					<label
						class="flex cursor-pointer flex-col items-center justify-center border border-dashed border-gray-600 bg-gray-800/30 px-4 py-6 text-center transition-colors hover:border-gray-500 hover:bg-gray-800/50"
					>
						<Upload class="mb-2 h-6 w-6 text-gray-500" />
						{#if uploadFile}<span class="text-xs font-medium text-gray-200">{uploadFile}</span
							>{#if uploadDetectedType}<span class="mt-1 text-[10px] text-gray-500"
									>Detected: .{uploadDetectedType}</span
								>{/if}{:else}<span class="text-xs text-gray-400"
								>Drop or click to browse (.iso, .img, .qcow2)</span
							>{/if}
						<input
							type="file"
							accept=".iso,.img,.qcow2"
							class="hidden"
							onchange={handleFileSelect}
						/>
					</label>
				{:else}
					<div class="flex flex-col gap-2">
						<Label>Image URL</Label><Input
							bind:value={uploadUrl}
							placeholder="https://example.com/image.iso"
							oninput={handleUrlChange}
						/>{#if uploadDetectedType}<p class="text-xs text-gray-500">
								Detected: .{uploadDetectedType}
							</p>{:else if uploadUrl}<p class="text-xs text-amber-500">
								Could not detect format. Will default to .img
							</p>{/if}
					</div>
				{/if}
			</div>
			<Dialog.Footer
				><Button variant="outline" size="sm" onclick={() => (uploadOpen = false)}>Cancel</Button
				><Button
					size="sm"
					onclick={startUpload}
					disabled={!uploadName.trim() && !uploadFile && !uploadUrl}
					><Upload class="h-3 w-3" /> Upload</Button
				></Dialog.Footer
			>
		</Dialog.Content>
	</Dialog.Root>
{/if}
