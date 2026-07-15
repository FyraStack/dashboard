<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { confirmController } from '$lib/confirm.svelte';

	let typed = $state('');

	const req = $derived(confirmController.request);
	const needsWord = $derived(!!req?.confirmWord);
	const canConfirm = $derived(!needsWord || typed.trim() === req?.confirmWord);

	$effect(() => {
		if (confirmController.open) {
			typed = '';
			tick().then(() => {
				(
					document.getElementById('confirm-name-input') ?? document.getElementById('confirm-ok-btn')
				)?.focus();
			});
		}
	});

	function decide(ok: boolean) {
		if (ok && !canConfirm) return;
		confirmController.resolve(ok);
		confirmController.open = false;
	}
</script>

<Dialog.Root
	bind:open={confirmController.open}
	onOpenChange={(value) => {
		if (!value) confirmController.resolve(false);
	}}
>
	<Dialog.Content
		class="z-101 max-w-md border-gray-800 bg-gray-900 text-gray-100 sm:max-w-md"
		overlayProps={{ class: 'z-100 bg-black/50' }}
		showCloseButton={false}
	>
		<Dialog.Header>
			<Dialog.Title>{req?.title}</Dialog.Title>
			<Dialog.Description>{req?.description}</Dialog.Description>
		</Dialog.Header>

		{#if needsWord}
			<div class="mt-4 space-y-1.5">
				<label for="confirm-name-input" class="block text-xs text-gray-400">
					Type <span class="font-mono text-gray-200">{req?.confirmWord}</span> to confirm
				</label>
				<Input
					id="confirm-name-input"
					bind:value={typed}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					onkeydown={(e) => {
						if (e.key === 'Enter') decide(true);
					}}
				/>
			</div>
		{/if}

		<Dialog.Footer class="mt-5">
			<Button variant="outline" size="sm" onclick={() => decide(false)}>Cancel</Button>
			<Button
				id="confirm-ok-btn"
				variant="destructive"
				size="sm"
				disabled={!canConfirm}
				onclick={() => decide(true)}
			>
				{req?.confirmLabel ?? 'Delete'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
