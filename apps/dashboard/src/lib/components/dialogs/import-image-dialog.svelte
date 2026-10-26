<script lang="ts" module>
	export interface ImportImageRequest {
		checksum: string;
		description: string;
		name: string;
		secureBoot: boolean;
		url: string;
		version: string;
	}

	const QCOW2_EXTENSION = /\.qcow2$/i;
</script>

<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { formatBytes, getErrorMessage } from '#lib/utils.js';

	let {
		open = $bindable(false),
		maxImageBytes,
		onSubmit
	}: {
		open?: boolean;
		maxImageBytes: number;
		onSubmit: (request: ImportImageRequest) => Promise<void>;
	} = $props();

	let url = $state('');
	let name = $state('');
	let version = $state('');
	let description = $state('');
	let checksum = $state('');
	let secureBoot = $state(false);
	let nameTouched = $state(false);
	let submitting = $state(false);
	let submitError = $state('');

	const urlError = $derived.by(() => {
		const value = url.trim();
		if (!value) {
			return '';
		}
		try {
			return new URL(value).protocol === 'https:' ? '' : 'The URL must start with https://';
		} catch {
			return 'Enter a valid URL';
		}
	});
	const canSubmit = $derived(
		url.trim().length > 0 &&
			!urlError &&
			name.trim().length > 0 &&
			name.trim().length <= 64 &&
			!submitting
	);

	function reset() {
		url = '';
		name = '';
		version = '';
		description = '';
		checksum = '';
		secureBoot = false;
		nameTouched = false;
		submitError = '';
	}

	function suggestName() {
		if (nameTouched || urlError) {
			return;
		}
		try {
			const filename = new URL(url.trim()).pathname.split('/').at(-1) ?? '';
			name = decodeURIComponent(filename).replace(QCOW2_EXTENSION, '').slice(0, 64);
		} catch {
			// Ignore half-typed URLs.
		}
	}

	async function submit() {
		if (!canSubmit) {
			return;
		}
		submitting = true;
		submitError = '';
		try {
			await onSubmit({
				url: url.trim(),
				name: name.trim(),
				version: version.trim(),
				description: description.trim(),
				checksum: checksum.trim(),
				secureBoot
			});
			open = false;
			reset();
		} catch (err) {
			submitError = getErrorMessage(err, 'Failed to import image');
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(value) => !(value || submitting) && reset()}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Import Image</Dialog.Title>
			<Dialog.Description>
				Import a qcow2 disk image from a public URL. Only members of this project can see or use it.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-2">
			<div class="flex flex-col gap-2">
				<Label for="custom-image-url">Image URL</Label>
				<Input
					id="custom-image-url"
					type="url"
					bind:value={url}
					onblur={suggestName}
					placeholder="https://example.com/images/my-image.qcow2"
				/>
				{#if urlError}
					<p class="text-xs text-red-500">{urlError}</p>
				{:else}
					<p class="text-xs text-muted-foreground">
						Must download a qcow2 file directly, up to {formatBytes(maxImageBytes)}.
					</p>
				{/if}
			</div>
			<div class="flex flex-col gap-2">
				<Label for="custom-image-name">Name</Label>
				<Input
					id="custom-image-name"
					bind:value={name}
					oninput={() => (nameTouched = true)}
					maxlength={64}
					placeholder="my-image"
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-2">
					<Label for="custom-image-version"
						>Version <span class="text-muted-foreground">(optional)</span></Label
					>
					<Input id="custom-image-version" bind:value={version} maxlength={32} placeholder="1.0" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="custom-image-checksum"
						>SHA-256 <span class="text-muted-foreground">(optional)</span></Label
					>
					<Input
						id="custom-image-checksum"
						bind:value={checksum}
						maxlength={135}
						placeholder="e3b0c442..."
						class="font-mono"
					/>
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="custom-image-description"
					>Description <span class="text-muted-foreground">(optional)</span></Label
				>
				<Textarea id="custom-image-description" bind:value={description} maxlength={500} rows={2} />
			</div>
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-1">
					<Label for="custom-image-secure-boot">Secure Boot</Label>
					<p class="text-xs text-muted-foreground">
						Only enable this if the image's bootloader is signed with Microsoft keys.
					</p>
				</div>
				<Switch id="custom-image-secure-boot" bind:checked={secureBoot} />
			</div>
			<p class="text-xs leading-relaxed text-muted-foreground">
				Images should support UEFI boot and cloud-init (NoCloud) so networking and SSH keys are set
				up on first boot. Raw images can be converted with
				<code class="font-mono">qemu-img convert -O qcow2</code>.
			</p>
			{#if submitError}
				<p class="text-xs text-red-500">{submitError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)} disabled={submitting}
				>Cancel</Button
			>
			<Button size="sm" onclick={submit} disabled={!canSubmit}>
				{submitting ? 'Checking image...' : 'Import'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
