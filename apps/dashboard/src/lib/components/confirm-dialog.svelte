<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '$lib/components/ui/button';
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

	function onKeydown(e: KeyboardEvent) {
		if (!confirmController.open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			decide(false);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if confirmController.open}
	<!-- z above bits-ui dialogs (z-50) so a confirm opened from another dialog sits on top -->
	<div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Cancel"
			class="absolute inset-0 bg-black/50"
			onclick={() => decide(false)}
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			aria-describedby="confirm-desc"
			class="relative z-10 w-full max-w-md border border-border bg-background p-4 text-sm text-foreground ring-1 ring-foreground/10"
		>
			<h2 id="confirm-title" class="text-base font-semibold text-foreground">{req?.title}</h2>
			<p id="confirm-desc" class="mt-1 text-sm text-muted-foreground">{req?.description}</p>
			{#if needsWord}
				<div class="mt-4 space-y-1.5">
					<label for="confirm-name-input" class="block text-xs text-muted-foreground">
						Type <span class="font-mono text-foreground">{req?.confirmWord}</span> to confirm
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
			<div class="mt-5 flex justify-end gap-2">
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
			</div>
		</div>
	</div>
{/if}
