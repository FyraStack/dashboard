<script lang="ts">
	import Loader2 from '~icons/lucide/loader-2';
	import DollarSign from '~icons/nucleo/dollar-sign';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { purchaseCredits } from '$lib/remote/billing.remote';
	import { getErrorMessage } from '$lib/utils';

	let {
		open = $bindable(false),
		projectId,
		prepaidPrice = null,
		remaining = null
	}: {
		open?: boolean;
		projectId: string;
		prepaidPrice?: { amount: number | null; billingUnits: number } | null;
		remaining?: number | null;
	} = $props();

	const packPrice = $derived(
		prepaidPrice?.amount != null && prepaidPrice.amount > 0 ? prepaidPrice.amount : null
	);
	const billingUnits = $derived(
		prepaidPrice && prepaidPrice.billingUnits > 0 ? prepaidPrice.billingUnits : 100
	);

	const presetAmounts = [5, 10, 25, 50];

	let loading = $state(false);
	let actionError = $state('');
	let amountInput = $state('10');

	const amount = $derived(Number.parseFloat(amountInput));
	const amountValid = $derived(Number.isFinite(amount) && amount > 0);
	const packs = $derived(packPrice != null && amountValid ? Math.ceil(amount / packPrice) : 0);
	const credits = $derived(packs * billingUnits);
	const billedNow = $derived(packPrice != null ? packs * packPrice : 0);
	const roundedUp = $derived(amountValid && packPrice != null && billedNow > amount);
	const canSubmit = $derived(packPrice != null && amountValid && credits > 0);
	const creditRate = $derived(packPrice != null ? packPrice / billingUnits : null);
	const balanceValue = $derived(
		remaining != null && creditRate != null ? remaining * creditRate : null
	);

	const currencyFormat = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });

	function formatCost(value: number) {
		return currencyFormat.format(value);
	}

	async function handlePurchase() {
		if (!projectId || loading || !canSubmit) return;

		loading = true;
		actionError = '';
		try {
			const result = await purchaseCredits({ projectId, credits });
			if (result.url) {
				window.location.href = result.url;
				return;
			}
			window.location.reload();
		} catch (err) {
			actionError = getErrorMessage(err, 'Credits could not be purchased. Try again.');
			loading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-border bg-background text-foreground sm:max-w-lg">
		<Dialog.Header>
			<div
				class="mb-2 flex size-10 items-center justify-center rounded-lg border border-border bg-background"
			>
				<DollarSign class="size-5 text-emerald-300" />
			</div>
			<Dialog.Title>Top-up credits</Dialog.Title>
			<Dialog.Description class="text-muted-foreground">
				Credits are used before pay-as-you-go usage is billed, and they'll never expire.
			</Dialog.Description>
		</Dialog.Header>

		{#if packPrice != null}
			<div class="space-y-2">
				<Label for="top-up-amount" class="text-sm text-muted-foreground">Amount</Label>
				<div class="relative">
					<span
						class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
					>
						$
					</span>
					<Input
						id="top-up-amount"
						type="number"
						inputmode="decimal"
						min={packPrice}
						step={packPrice}
						bind:value={amountInput}
						disabled={loading}
						class="border-border bg-background pr-12 pl-7 text-foreground tabular-nums"
					/>
					<span
						class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
					>
						USD
					</span>
				</div>
				<div class="flex gap-1.5">
					{#each presetAmounts as preset (preset)}
						<button
							type="button"
							disabled={loading}
							onclick={() => (amountInput = String(preset))}
							class="rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors {amountValid &&
							amount === preset
								? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
								: 'border-border/60 text-muted-foreground hover:bg-muted/50'}"
						>
							${preset}
						</button>
					{/each}
				</div>
			</div>

			<div class="rounded-md border border-border/60 bg-background/40">
				{#if balanceValue != null}
					<div class="flex items-center justify-between px-3.5 py-2.5 text-sm">
						<span class="text-muted-foreground">New balance</span>
						<span class="font-medium text-foreground tabular-nums">
							{formatCost(canSubmit ? balanceValue + billedNow : balanceValue)}
						</span>
					</div>
				{/if}
				<div
					class="flex items-center justify-between px-3.5 py-2.5 text-sm {balanceValue != null
						? 'border-t border-border/40'
						: ''}"
				>
					<span class="text-muted-foreground">Billed now</span>
					<span class="font-semibold text-foreground tabular-nums">
						{canSubmit ? formatCost(billedNow) : '-'}
					</span>
				</div>
			</div>

			{#if roundedUp}
				<p class="text-xs text-muted-foreground">
					Credits are sold in {formatCost(packPrice)} increments, so the amount is rounded up to {formatCost(
						billedNow
					)}.
				</p>
			{/if}
		{:else}
			<div class="rounded-md border border-border/60 bg-background/40 px-3.5 py-2.5">
				<p class="text-sm text-muted-foreground">
					Credit pricing is unavailable right now. Try again in a moment.
				</p>
			</div>
		{/if}

		{#if actionError}
			<div
				class="rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
			>
				{actionError}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>Not now</Button>
			<Button size="sm" onclick={handlePurchase} disabled={loading || !canSubmit}>
				{#if loading}
					<Loader2 class="size-3.5 animate-spin" />
				{/if}
				{canSubmit ? `Top-up ${formatCost(billedNow)}` : 'Top-up credits'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
