<script lang="ts">
	import type { AnnouncementImageInput } from 'stack-backend/types';
	import type { AnnouncementImageType } from 'stack-shared/announcements';
	import { toast } from 'svelte-sonner';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { confirmDestructive } from '#lib/confirm.svelte.js';
	import {
		createAnnouncement,
		deleteAnnouncement,
		updateAnnouncement
	} from '#lib/remote/announcements.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Megaphone from '~icons/nucleo/megaphone';
	import Pencil from '~icons/nucleo/pencil';
	import Trash2 from '~icons/nucleo/trash';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type AdminAnnouncement = PageData['announcements'][number];

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
	const imageTypes: AnnouncementImageType[] = [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif'
	];
	const MAX_IMAGE_BYTES = 1024 * 1024;

	let dialogOpen = $state(false);
	let editingId = $state<string | null>(null);
	let title = $state('');
	let body = $state('');
	let linkUrl = $state('');
	let linkLabel = $state('');
	let published = $state(false);
	let imagePreview = $state<string | null>(null);
	let imageChange = $state<AnnouncementImageInput | null | undefined>(undefined);
	let imageInput = $state<HTMLInputElement | null>(null);
	let saving = $state(false);
	let formError = $state('');

	const canSave = $derived(!saving && title.trim().length > 0 && body.trim().length > 0);

	function openCreate() {
		editingId = null;
		title = '';
		body = '';
		linkUrl = '';
		linkLabel = '';
		published = false;
		imagePreview = null;
		imageChange = undefined;
		formError = '';
		dialogOpen = true;
	}

	function openEdit(announcement: AdminAnnouncement) {
		({ id: editingId, title, body } = announcement);
		linkUrl = announcement.linkUrl ?? '';
		linkLabel = announcement.linkLabel ?? '';
		published = announcement.publishedAt !== null;
		imagePreview = imageUrl(announcement);
		imageChange = undefined;
		formError = '';
		dialogOpen = true;
	}

	function imageUrl({ id, imageVersion }: AdminAnnouncement) {
		return imageVersion === null
			? null
			: `${resolve(`announcements/${id}/image`)}?v=${imageVersion}`;
	}

	function isImageType(value: string): value is AnnouncementImageType {
		return imageTypes.some((imageType) => imageType === value);
	}

	function readAsDataUrl(file: File) {
		return new Promise<string>((done, fail) => {
			const reader = new FileReader();
			reader.onload = () => done(String(reader.result));
			reader.onerror = () => fail(reader.error);
			reader.readAsDataURL(file);
		});
	}

	async function selectImage(event: Event & { currentTarget: HTMLInputElement }) {
		const [file] = event.currentTarget.files ?? [];
		event.currentTarget.value = '';
		if (!file) {
			return;
		}
		if (!isImageType(file.type)) {
			formError = 'Image must be a PNG, JPEG, WebP, or GIF';
			return;
		}
		if (file.size > MAX_IMAGE_BYTES) {
			formError = 'Image must be 1 MB or smaller';
			return;
		}
		try {
			const dataUrl = await readAsDataUrl(file);
			imagePreview = dataUrl;
			imageChange = { type: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
			formError = '';
		} catch (err) {
			formError = getErrorMessage(err, 'Failed to read image');
		}
	}

	function removeImage() {
		imagePreview = null;
		imageChange = null;
	}

	async function save() {
		if (!canSave) {
			return;
		}
		saving = true;
		formError = '';
		const fields = {
			title: title.trim(),
			body: body.trim(),
			linkUrl: linkUrl.trim() || null,
			linkLabel: linkLabel.trim() || null,
			published,
			...(imageChange === undefined ? {} : { image: imageChange })
		};
		try {
			if (editingId) {
				await updateAnnouncement({ announcementId: editingId, ...fields });
			} else {
				await createAnnouncement(fields);
			}
			await invalidate('app:admin-announcements');
			dialogOpen = false;
		} catch (err) {
			formError = getErrorMessage(err, 'Failed to save announcement');
		} finally {
			saving = false;
		}
	}

	async function remove(announcement: AdminAnnouncement) {
		const confirmed = await confirmDestructive({
			title: 'Delete announcement',
			description: `"${announcement.title}" will be removed for everyone, including users who haven't seen it yet.`,
			confirmLabel: 'Delete announcement'
		});
		if (!confirmed) {
			return;
		}
		try {
			await deleteAnnouncement({ announcementId: announcement.id });
			await invalidate('app:admin-announcements');
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete announcement'));
		}
	}
</script>

<div class="flex-1 overflow-auto">
	<div class="flex items-center justify-end border-b border-border/60 px-5 py-2">
		<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={openCreate}>
			<Plus class="h-3 w-3" />
			New announcement
		</Button>
	</div>
	{#if data.announcements.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
			<Megaphone class="mb-3 h-6 w-6" />
			<p class="text-xs">No announcements yet</p>
			<Button variant="outline" size="sm" class="mt-3 gap-1.5 text-xs" onclick={openCreate}>
				<Plus class="h-3 w-3" />
				New announcement
			</Button>
		</div>
	{:else}
		<table class="w-full">
			<thead>
				<tr class="border-b border-border">
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Title</th>
					<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
					<th
						class="hidden px-5 py-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground sm:table-cell"
					>
						Published
					</th>
					<th
						class="hidden px-5 py-3 text-right text-xs font-medium whitespace-nowrap text-muted-foreground sm:table-cell"
					>
						Seen by
					</th>
					<th class="px-5 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-border/50">
				{#each data.announcements as announcement (announcement.id)}
					<tr class="transition-colors hover:bg-muted/20">
						<td class="max-w-md px-5 py-3">
							<p class="truncate text-sm font-medium text-foreground">{announcement.title}</p>
							<p class="truncate text-xs text-muted-foreground">{announcement.body}</p>
						</td>
						<td class="px-5 py-3">
							{#if announcement.publishedAt === null}
								<Badge variant="secondary" class="text-[10px]">Draft</Badge>
							{:else}
								<Badge
									class="bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
								>
									Published
								</Badge>
							{/if}
						</td>
						<td
							class="hidden px-5 py-3 text-sm whitespace-nowrap text-muted-foreground sm:table-cell"
						>
							{announcement.publishedAt === null
								? '—'
								: dateFormat.format(announcement.publishedAt)}
						</td>
						<td
							class="hidden px-5 py-3 text-right text-sm text-muted-foreground tabular-nums sm:table-cell"
						>
							{announcement.readCount}
						</td>
						<td class="px-5 py-3 text-right">
							<div class="flex items-center justify-end gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
									aria-label={`Edit ${announcement.title}`}
									onclick={() => openEdit(announcement)}
								>
									<Pencil class="h-3 w-3" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
									aria-label={`Delete ${announcement.title}`}
									onclick={() => remove(announcement)}
								>
									<Trash2 class="h-3 w-3" />
								</Button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto border-border bg-background sm:max-w-lg"
	>
		<Dialog.Header>
			<Dialog.Title>{editingId ? 'Edit announcement' : 'New announcement'}</Dialog.Title>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-2">
			{#if formError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="size-4 shrink-0" />{formError}
				</div>
			{/if}
			<div class="flex flex-col gap-2">
				<Label for="announcement-title">Title</Label>
				<Input id="announcement-title" bind:value={title} maxlength={200} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="announcement-body">Body</Label>
				<Textarea id="announcement-body" bind:value={body} rows={8} maxlength={10_000} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="announcement-image">Image (optional)</Label>
				{#if imagePreview}
					<img
						src={imagePreview}
						alt="Announcement preview"
						class="aspect-[2/1] w-full rounded-lg bg-muted object-cover ring-1 ring-foreground/10"
					/>
				{/if}
				<div class="flex items-center gap-2">
					<input
						bind:this={imageInput}
						id="announcement-image"
						type="file"
						accept={imageTypes.join(',')}
						class="sr-only"
						onchange={selectImage}
					/>
					<Button variant="outline" size="sm" onclick={() => imageInput?.click()}>
						{imagePreview ? 'Replace image' : 'Upload image'}
					</Button>
					{#if imagePreview}
						<Button
							variant="ghost"
							size="sm"
							class="text-red-400 hover:text-red-300"
							onclick={removeImage}
						>
							Remove
						</Button>
					{/if}
				</div>
				<p class="text-[11px] text-muted-foreground">
					PNG, JPEG, WebP, or GIF up to 1 MB. Shown at 2:1 and cropped to fit.
				</p>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
				<div class="flex flex-col gap-2">
					<Label for="announcement-link-url">Link URL (optional)</Label>
					<Input
						id="announcement-link-url"
						type="url"
						bind:value={linkUrl}
						placeholder="https://"
						maxlength={2000}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="announcement-link-label">Link text</Label>
					<Input
						id="announcement-link-label"
						bind:value={linkLabel}
						placeholder="Learn more"
						maxlength={100}
						disabled={!linkUrl.trim()}
					/>
				</div>
			</div>
			<div class="flex items-center justify-between gap-4">
				<Label for="announcement-published">Published</Label>
				<Switch id="announcement-published" bind:checked={published} />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={save} disabled={!canSave}>
				{#if saving}
					<Loader2 class="h-3 w-3 animate-spin" />
				{/if}
				{editingId ? 'Save' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
