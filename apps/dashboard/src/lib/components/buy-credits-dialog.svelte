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
		prepaidPrice = null
	}: {
		open?: boolean;
		projectId: string;
		prepaidPrice?: { amount: number | null; billingUnits: number } | null;
	} = $props();

	const billingUnits = $derived(
		prepaidPrice && prepaidPrice.billingUnits > 0 ? prepaidPrice.billingUnits : 100
	);

	let loading = $state(false);
	let actionError = $state('');
	let creditsInput = $state('500');

	const credits = $derived(Number.parseInt(creditsInput, 10));
	const creditsValid = $derived(Number.isInteger(credits) && credits > 0);
	const estimatedCost = $derived(
		creditsValid && prepaidPrice?.amount != null
			? Math.ceil(credits / billingUnits) * prepaidPrice.amount
			: null
	);

	function formatCost(value: number) {
		return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(value);
	}

	async function handlePurchase() {
		if (!projectId || loading || !creditsValid) return;

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
			<Dialog.Title>Buy credits</Dialog.Title>
			<Dialog.Description class="text-muted-foreground">
				Prepaid credits are drawn down before any pay-as-you-go usage is billed. They don't expire
				at the end of the billing cycle.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-1.5">
			<Label for="buy-credits-amount" class="text-sm text-muted-foreground">Credits</Label>
			<Input
				id="buy-credits-amount"
				type="number"
				inputmode="numeric"
				min="1"
				step={billingUnits}
				bind:value={creditsInput}
				disabled={loading}
				class="border-border bg-background text-foreground"
			/>
			<p class="text-xs text-muted-foreground">
				{#if estimatedCost != null}
					Billed as {formatCost(estimatedCost)}{credits % billingUnits !== 0
						? ` (rounded up to the next ${billingUnits} credits)`
						: ''}.
				{:else}
					Sold in packs of {billingUnits} credits.
				{/if}
			</p>
		</div>

		{#if actionError}
			<div
				class="rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
			>
				{actionError}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>Not now</Button>
			<Button size="sm" onclick={handlePurchase} disabled={loading || !creditsValid}>
				{#if loading}
					<Loader2 class="size-3.5 animate-spin" />
				{/if}
				Buy credits
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
