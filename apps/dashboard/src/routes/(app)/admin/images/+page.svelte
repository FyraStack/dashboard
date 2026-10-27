<script lang="ts">
	import { untrack } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { autofillAttributes } from '#lib/components/ui/input/autofill.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { type AdminPageData, AdminState } from '#lib/state/admin.svelte.js';
	import GripVertical from '~icons/lucide/grip-vertical';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Disc from '~icons/nucleo/disc';
	import Image from '~icons/nucleo/layers';
	import Pencil from '~icons/nucleo/pencil';
	import RefreshCw from '~icons/nucleo/refresh-cw';
	import Trash2 from '~icons/nucleo/trash';
	import Upload from '~icons/nucleo/upload';

	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	function formatSize(bytes: number) {
		const mb = bytes / (1024 * 1024);
		if (mb >= 1024) {
			return `${(mb / 1024).toFixed(1)} GB`;
		}
		return `${mb.toFixed(0)} MB`;
	}

	function svgDataUrl(svg: string) {
		return `data:image/svg+xml,${encodeURIComponent(svg)}`;
	}

	let imgDragIndex = $state<number | null>(null);
	let imgDropIndex = $state<number | null>(null);

	function imgDragStart(event: DragEvent, index: number) {
		imgDragIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', String(index));
			const group = (event.target as HTMLElement).closest('tbody');
			if (group) {
				event.dataTransfer.setDragImage(group, 0, 0);
			}
		}
	}

	function imgDragOver(event: DragEvent, index: number) {
		if (imgDragIndex === null) {
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		imgDropIndex = index;
	}

	function imgDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (imgDragIndex !== null) {
			admin.imgReorderGroups(imgDragIndex, index);
		}
		imgDragIndex = null;
		imgDropIndex = null;
	}

	function imgDragEnd() {
		imgDragIndex = null;
		imgDropIndex = null;
	}

	function imgHandleKeydown(event: KeyboardEvent, index: number) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
			return;
		}
		event.preventDefault();
		admin.imgReorderGroups(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
	}

	const dialogTitles = {
		create: 'Add Image',
		addVersions: 'Add Versions',
		edit: 'Edit Version',
		editGroup: 'Edit Image Details'
	} as const;

	let showSharedFields = $derived(admin.imgMode === 'create' || admin.imgMode === 'editGroup');
	let showVersionRows = $derived(admin.imgMode !== 'editGroup');
	let groupVersionCount = $derived(
		admin.imgGroupName
			? (admin.imageGroups.find((group) => group.name === admin.imgGroupName)?.versions.length ?? 0)
			: 0
	);
	let saveLabel = $derived.by(() => {
		if (admin.imgMode === 'edit' || admin.imgMode === 'editGroup') {
			return 'Save';
		}
		const count = admin.imgRows.length;
		if (count > 1) {
			return `Add ${count} versions`;
		}
		return admin.imgMode === 'create' ? 'Create' : 'Add version';
	});
	let localImportTargets = $derived(
		admin.pveImageImportTargets.filter((target) => target.storage === admin.importStorage)
	);
</script>

<div class="flex-1 overflow-auto">
	<div class="flex items-center justify-end gap-2 border-b border-border/60 px-5 py-2">
		<Button
			size="sm"
			variant="outline"
			class="h-7 gap-1.5 text-xs"
			onclick={() => admin.imgImportOpen()}
		>
			<Upload class="h-3 w-3" />
			Upload/Import Image
		</Button>
		<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={() => admin.imgOpenCreate()}>
			<Plus class="h-3 w-3" />
			Add Image
		</Button>
	</div>
	{#if admin.images.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<Disc class="mb-3 h-6 w-6" />
			<p class="text-xs">No images configured</p>
			<Button
				variant="outline"
				size="sm"
				class="mt-3 gap-1.5 text-xs"
				onclick={() => admin.imgOpenCreate()}
				><Plus class="h-3 w-3" />
				Add Image</Button
			>
		</div>
	{:else}
		<table class="w-full whitespace-nowrap">
			<thead>
				<tr class="border-b border-border">
					<th class="w-8 px-3 py-3"><span class="sr-only">Drag handle</span></th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Image</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Type</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
						Proxmox Path
					</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Secure Boot</th>
					<th class="px-5 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
				</tr>
			</thead>
			{#each admin.imageGroups as group, index (group.name)}
				{@const rep = group.representative}
				<tbody
					class="border-b border-border transition-colors {imgDragIndex === index
						? 'opacity-40'
						: ''} {imgDropIndex === index && imgDragIndex !== index ? 'bg-muted/40' : ''}"
				>
					<tr
						class="bg-muted/20"
						ondragover={(event) => imgDragOver(event, index)}
						ondrop={(event) => imgDrop(event, index)}
					>
						<td class="px-3 py-3">
							<button
								type="button"
								aria-label={`Drag or use arrow keys to reorder ${group.name}`}
								draggable="true"
								class="flex h-7 w-5 cursor-grab items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus:text-muted-foreground focus:outline-none active:cursor-grabbing"
								ondragstart={(event) => imgDragStart(event, index)}
								ondragend={imgDragEnd}
								onkeydown={(event) => imgHandleKeydown(event, index)}
							>
								<GripVertical class="h-3.5 w-3.5" />
							</button>
						</td>
						<td class="px-5 py-3" colspan="4">
							<div class="flex items-center gap-2.5">
								<span
									class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden text-white {rep.color}"
								>
									{#if rep.isOfficial && rep.logoSvg}
										<img src={svgDataUrl(rep.logoSvg)} alt="" class="h-4 w-4" />
									{:else}
										<Disc class="size-4" />
									{/if}
								</span>
								<div class="flex min-w-0 flex-col gap-0.5">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-foreground">{group.name}</span>
										{#if rep.isOfficial}
											<Badge
												variant="secondary"
												class="text-[10px] text-emerald-700 dark:text-emerald-300"
												>Official</Badge
											>
										{/if}
										<span class="text-[10px] text-muted-foreground">
											{group.versions.length}
											version{group.versions.length === 1 ? '' : 's'}
										</span>
									</div>
									{#if rep.description}
										<span class="max-w-md truncate text-xs text-muted-foreground"
											>{rep.description}</span
										>
									{/if}
								</div>
							</div>
						</td>
						<td class="px-5 py-3 text-right">
							<div class="flex items-center justify-end gap-1">
								<Button
									variant="outline"
									size="sm"
									class="h-7 gap-1 px-2 text-xs"
									onclick={() => admin.imgOpenAddVersions(group.name)}
									><Plus class="h-3 w-3" />
									Version</Button
								>
								<Button
									variant="ghost"
									size="sm"
									aria-label={`Edit details for ${group.name}`}
									class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
									onclick={() => admin.imgOpenEditGroup(group.name)}
									><Pencil class="h-3 w-3" /></Button
								>
							</div>
						</td>
					</tr>
					{#each group.versions as img (img.id)}
						<tr
							class="transition-colors hover:bg-muted/20"
							ondragover={(event) => imgDragOver(event, index)}
							ondrop={(event) => imgDrop(event, index)}
						>
							<td></td>
							<td class="py-2 pr-5 pl-14 text-sm text-foreground">
								{img.version || '—'}
							</td>
							<td class="px-5 py-2">
								<Badge variant="secondary" class="text-[10px]">{img.imageType || 'import'}</Badge>
							</td>
							<td class="max-w-xs truncate px-5 py-2 font-mono text-xs text-muted-foreground">
								{img.filePath}
							</td>
							<td class="px-5 py-2 text-xs text-muted-foreground">
								{img.secureBoot ? 'On' : 'Off'}
							</td>
							<td class="px-5 py-2 text-right">
								<div class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Edit ${img.name} ${img.version}`}
										class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
										onclick={() => admin.imgOpenEdit(img)}
										><Pencil class="h-3 w-3" /></Button
									>
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Delete ${img.name} ${img.version}`}
										class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
										onclick={() => admin.imgRemove(img.id)}
										><Trash2 class="h-3 w-3" /></Button
									>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			{/each}
		</table>
	{/if}
</div>

<!-- Import Image Dialog -->
<Dialog.Root bind:open={admin.importDialogOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Upload/Import Image</Dialog.Title>
			<Dialog.Description>
				Import a VM image from a URL to every online Proxmox node using local storage.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			{#if admin.importError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="size-4 shrink-0" />{admin.importError}
				</div>
			{/if}

			<div class="flex items-center justify-between">
				<p class="text-xs text-muted-foreground">
					Target: <span class="font-mono text-muted-foreground">{admin.importStorage}</span> on
					{localImportTargets.length}
					node{localImportTargets.length === 1 ? '' : 's'}.
				</p>
				<Button
					variant="ghost"
					size="sm"
					class="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
					onclick={() => admin.loadPveImages()}
					disabled={admin.isoLoading || admin.importSaving}
				>
					{#if admin.isoLoading}
						<Loader2 class="h-3 w-3 animate-spin" />
					{:else}
						<RefreshCw class="h-3 w-3" />
					{/if}
					Refresh
				</Button>
			</div>

			{#if admin.isoError}
				<p class="text-xs text-red-400">{admin.isoError}</p>
			{:else if localImportTargets.length === 0}
				<p class="text-xs text-muted-foreground">
					No online nodes expose import-capable local storage.
				</p>
			{/if}

			<div class="flex flex-col gap-2">
				<Label>Image URL</Label>
				<Input
					bind:value={admin.importUrl}
					placeholder="https://example.com/images/fedora.qcow2"
					disabled={admin.importSaving}
					onchange={() => !admin.importFilename.trim() && admin.importFilenameFromUrl()}
				/>
			</div>

			<div class="flex flex-col gap-2">
				<Label>Filename</Label>
				<Input
					bind:value={admin.importFilename}
					placeholder="fedora.qcow2"
					disabled={admin.importSaving}
					onfocus={() => !admin.importFilename.trim() && admin.importFilenameFromUrl()}
				/>
			</div>

			<div class="grid grid-cols-[10rem_1fr] gap-3">
				<div class="flex flex-col gap-2">
					<Label>Checksum</Label>
					<select
						bind:value={admin.importChecksumAlgorithm}
						class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
						disabled={admin.importSaving}
					>
						<option value="">None</option>
						<option value="md5">md5</option>
						<option value="sha1">sha1</option>
						<option value="sha224">sha224</option>
						<option value="sha256">sha256</option>
						<option value="sha384">sha384</option>
						<option value="sha512">sha512</option>
					</select>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Checksum Value</Label>
					<Input
						bind:value={admin.importChecksum}
						placeholder="optional"
						disabled={admin.importSaving || !admin.importChecksumAlgorithm}
					/>
				</div>
			</div>

			<label class="flex items-center gap-2 text-sm text-muted-foreground">
				<input
					type="checkbox"
					bind:checked={admin.importVerifyCertificates}
					disabled={admin.importSaving}
					class="h-4 w-4"
				/>
				Verify TLS certificates
			</label>

			{#if admin.importTasks.length > 0}
				<div
					class="border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground"
				>
					{#each admin.importTasks as task (task.node)}
						<div class="flex justify-between gap-4">
							<span>{task.node}</span>
							<span>{task.status}{task.exitstatus ? ` (${task.exitstatus})` : ''}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				size="sm"
				onclick={() => admin.imgImportClose()}
				disabled={admin.importSaving}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={() => admin.importImageFromUrl()}
				disabled={admin.importSaving || !admin.importUrl.trim() || localImportTargets.length === 0}
			>
				{#if admin.importSaving}
					<Loader2 class="h-3 w-3 animate-spin" />
				{/if}
				Import
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Image Dialog -->
<Dialog.Root bind:open={admin.imgDialogOpen}>
	<Dialog.Content
		class="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto border-border bg-background sm:max-w-2xl"
	>
		<Dialog.Header>
			<Dialog.Title>{dialogTitles[admin.imgMode]}</Dialog.Title>
			<Dialog.Description>
				{#if admin.imgMode === 'editGroup'}
					Changes apply to all {groupVersionCount} version{groupVersionCount === 1 ? '' : 's'}
					of this image.
				{:else if admin.imgMode === 'edit'}
					Edit this version. Name, logo and description are shared, so edit them from the image row.
				{:else}
					Configure a base image and one or more versions for VM provisioning.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex min-w-0 flex-col gap-4 py-4">
			{#if admin.imgError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="size-4 shrink-0" />{admin.imgError}
				</div>
			{/if}

			{#if !showSharedFields}
				<!-- Compact summary of the family these versions belong to -->
				<div class="flex items-center gap-3 border border-border bg-muted/40 px-3 py-2.5">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden text-white {admin.imgColor}"
					>
						{#if admin.imgIsOfficial && admin.imgLogoSvg.trim()}
							<img src={svgDataUrl(admin.imgLogoSvg)} alt="" class="h-5 w-5" />
						{:else}
							<Disc class="size-4" />
						{/if}
					</span>
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="text-sm font-medium text-foreground">{admin.imgName}</span>
						<span class="line-clamp-2 text-xs text-muted-foreground">
							{groupVersionCount}
							existing version{groupVersionCount === 1 ? '' : 's'}{admin.imgDescription
								? ` · ${admin.imgDescription}`
								: ''}
						</span>
					</div>
					{#if admin.imgMode === 'addVersions'}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 px-2 text-xs text-muted-foreground"
							onclick={() => admin.imgDetachFromGroup()}
							>New image instead</Button
						>
					{/if}
				</div>
			{/if}

			{#if showSharedFields}
				<div class="flex flex-col gap-2">
					<Label for="img-name">Name</Label>
					<Input
						id="img-name"
						bind:value={admin.imgName}
						placeholder="Fedora Server"
						list={admin.imgMode === 'create' ? 'img-existing-names' : undefined}
						onchange={() => admin.imgAdoptExistingName()}
					/>
					<datalist id="img-existing-names">
						{#each admin.imageGroups as group (group.name)}
							<option value={group.name}></option>
						{/each}
					</datalist>
					{#if admin.imgMode === 'create'}
						<p class="text-[11px] text-muted-foreground">
							Pick an existing name to add versions to it instead of re-entering details.
						</p>
					{/if}
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label>Architecture</Label>
						<div
							class="flex h-9 items-center border border-border bg-muted px-3 text-sm text-muted-foreground"
						>
							x86
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label>Official</Label>
						<label
							class="flex h-9 items-center gap-2 border border-border bg-muted px-3 text-sm text-muted-foreground"
						>
							<input type="checkbox" bind:checked={admin.imgIsOfficial} class="h-4 w-4" />
							Official image
						</label>
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<Label>Description</Label>
					<textarea
						bind:value={admin.imgDescription}
						placeholder="Short description of this image..."
						rows="2"
						class="w-full resize-none border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
					></textarea>
				</div>

				{#if admin.imgIsOfficial}
					<div class="grid grid-cols-[1fr_auto] gap-3">
						<div class="flex flex-col gap-2">
							<Label
								>Logo SVG
								<span class="font-normal text-muted-foreground">(official only)</span></Label
							>
							<textarea
								bind:value={admin.imgLogoSvg}
								placeholder="<svg ...></svg>"
								rows="3"
								class="w-full resize-none border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
							></textarea>
						</div>
						<div class="flex flex-col gap-2">
							<Label>Preview</Label>
							<div
								class="flex h-20 w-20 items-center justify-center border border-border bg-muted p-3 text-muted-foreground"
								style:color={admin.imgAccentColor}
							>
								{#if admin.imgLogoSvg.trim()}
									<img src={svgDataUrl(admin.imgLogoSvg)} alt="" class="h-12 w-12" />
								{:else}
									<Image class="h-6 w-6" />
								{/if}
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label>Accent Color</Label>
						<Input bind:value={admin.imgAccentColor} placeholder="#6b7280" />
					</div>
				{/if}
			{/if}

			{#if showVersionRows}
				<div class="flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<Label>{admin.imgMode === 'edit' ? 'Version' : 'Versions'}</Label>
						<Button
							variant="ghost"
							size="sm"
							class="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
							onclick={() => admin.loadPveImages()}
							disabled={admin.isoLoading}
						>
							{#if admin.isoLoading}
								<Loader2 class="h-3 w-3 animate-spin" />
							{:else}
								<RefreshCw class="h-3 w-3" />
							{/if}
							Refresh images
						</Button>
					</div>

					<div class="flex flex-col divide-y divide-border/60 border border-border">
						<div
							class="grid grid-cols-[7rem_1fr_auto_1.75rem] items-center gap-2 bg-muted/40 px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase"
						>
							<span>Version</span>
							<span>Proxmox image</span>
							<span>Secure Boot</span>
							<span class="sr-only">Remove</span>
						</div>
						{#each admin.imgRows as row, rowIndex (row.key)}
							<div class="grid grid-cols-[7rem_1fr_auto_1.75rem] items-center gap-2 px-2 py-2">
								<Input
									bind:value={row.version}
									placeholder="42"
									aria-label={`Version ${rowIndex + 1}`}
									class="h-8 text-sm"
								/>
								<select
									bind:value={row.filePath}
									onchange={() => admin.imgRowFileChanged(row)}
									aria-label={`Proxmox image for version ${rowIndex + 1}`}
									class="h-8 w-full min-w-0 border border-border bg-muted px-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
								>
									<option value="">Select an imported image</option>
									{#each admin.pveImages as image (image.volid)}
										{@const usedBy = admin.imgUsedFiles.get(image.volid)}
										<option value={image.volid}>
											{image.volid}
											· {formatSize(image.size)}{usedBy ? ` · used by ${usedBy}` : ''}
										</option>
									{/each}
								</select>
								<label
									class="flex h-8 items-center justify-center px-2"
									title="Enable UEFI Secure Boot for VMs using this version"
								>
									<input
										type="checkbox"
										bind:checked={row.secureBoot}
										class="h-4 w-4"
										aria-label={`Secure Boot for version ${rowIndex + 1}`}
									/>
								</label>
								{#if admin.imgRows.length > 1}
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Remove version ${rowIndex + 1}`}
										class="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
										onclick={() => admin.imgRemoveRow(row.key)}
										><X class="h-3 w-3" /></Button
									>
								{:else}
									<span></span>
								{/if}
							</div>
						{/each}
					</div>

					{#if admin.imgMode !== 'edit'}
						<Button
							variant="outline"
							size="sm"
							class="h-7 w-fit gap-1 text-xs"
							onclick={() => admin.imgAddRow()}
							><Plus class="h-3 w-3" />
							Add another version</Button
						>
					{/if}

					{#if admin.isoError}
						<p class="text-xs text-red-400">{admin.isoError}</p>
					{:else if admin.pveImages.length === 0 && !admin.isoLoading}
						<p class="text-xs text-muted-foreground">
							No imported images found. Use Upload/Import Image first.
						</p>
					{/if}
					{#if admin.imgDuplicateVersions.length > 0}
						<p class="text-xs text-amber-600 dark:text-amber-400">
							Heads up: {admin.imgDuplicateVersions.join(', ')} already exists for this image.
						</p>
					{/if}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (admin.imgDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={() => admin.imgSave()}
				disabled={admin.imgSaving || !admin.imgName.trim() || !admin.imgRowsValid}
			>
				{#if admin.imgSaving}
					<Loader2 class="h-3 w-3 animate-spin" />
				{/if}
				{saveLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
