<script lang="ts">
	import { projectBillingPath } from 'stack-shared/routes';
	import BillingSetupDialog from '#lib/components/billing-setup-dialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { formatCurrency, formatDate, formatDecimal, formatUsd } from '#lib/format.js';
	import { idempotent } from '#lib/idempotency.js';
	import { openBillingPortal, purchaseCredits } from '#lib/remote/billing.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { type StatusTone, statusBadgeClass } from '#lib/vm-status.js';
	import Loader2 from '~icons/lucide/loader-2';
	import Cpu from '~icons/nucleo/cpu';
	import CreditCard from '~icons/nucleo/credit-card';
	import DollarSign from '~icons/nucleo/dollar-sign';
	import Server from '~icons/nucleo/server';
	import type { PageProps } from './$types';

	const DEFAULT_BILLING_UNITS_PER_PACK = 100;
	const topUpPresets = [5, 10, 25, 50];

	let { data }: PageProps = $props();

	let billingSetupOpen = $state(false);
	let buyCreditsOpen = $state(false);
	let portalLoading = $state(false);
	let actionError = $state('');

	let topUpAmountInput = $state('10');
	let topUpLoading = $state(false);
	let topUpError = $state('');
	let topUpResult = $state<{ url: string | null } | null>(null);

	const { projectId } = $derived(data);
	const { billing, canManageBilling } = $derived(data);
	const billingReady = $derived(!billing.setupRequired);
	const { activeResources, credits } = $derived(billing);
	const activeServers = $derived(activeResources.reduce((total, r) => total + r.count, 0));
	const totalHours = $derived(activeResources.reduce((total, r) => total + r.hours, 0));
	const totalCost = $derived(activeResources.reduce((total, r) => total + (r.cost ?? 0), 0));
	const hasCost = $derived(activeResources.some((r) => r.cost !== null));
	const invoices = $derived([...billing.invoices].sort((a, b) => b.createdAt - a.createdAt));
	const canBuyCredits = $derived(Boolean(credits) && canManageBilling && billingReady);

	const packPrice = $derived.by(() => {
		const amount = credits?.prepaidPrice?.amount ?? 0;
		return amount > 0 ? amount : null;
	});
	const billingUnits = $derived(
		credits?.prepaidPrice && credits.prepaidPrice.billingUnits > 0
			? credits.prepaidPrice.billingUnits
			: DEFAULT_BILLING_UNITS_PER_PACK
	);
	const creditRate = $derived(packPrice === null ? null : packPrice / billingUnits);
	const balanceValue = $derived(
		credits && creditRate !== null ? credits.remaining * creditRate : null
	);
	const topUpAmount = $derived(Number.parseFloat(topUpAmountInput));
	const topUpAmountValid = $derived(Number.isFinite(topUpAmount) && topUpAmount > 0);
	const packs = $derived(
		packPrice !== null && topUpAmountValid ? Math.ceil(topUpAmount / packPrice - 1e-6) : 0
	);
	const billedNow = $derived(packPrice === null ? 0 : packs * packPrice);
	const roundedUp = $derived(topUpAmountValid && packPrice !== null && billedNow > topUpAmount);
	const canSubmitTopUp = $derived(
		packPrice !== null && topUpAmountValid && packs * billingUnits > 0
	);

	const billingActionLabel = $derived.by(() => {
		if (portalLoading) {
			return 'Opening portal...';
		}
		return billingReady ? 'Open billing portal' : 'Set up billing';
	});

	function invoiceTone(status: string): StatusTone {
		const normalized = status.toLowerCase();
		if (normalized === 'paid') {
			return 'success';
		}
		if (normalized === 'open' || normalized === 'draft') {
			return 'warning';
		}
		return 'muted';
	}

	function friendlyLabel(value: string, fallback: string) {
		if (!value.trim()) {
			return fallback;
		}
		return value
			.replace(/[_-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\b\w/g, (letter) => letter.toUpperCase());
	}

	async function handleBillingAction() {
		if (!billingReady) {
			billingSetupOpen = true;
			return;
		}
		if (!projectId || portalLoading) {
			return;
		}

		portalLoading = true;
		actionError = '';
		try {
			const result = await openBillingPortal({ projectId });
			window.location.href = result.url;
		} catch (err) {
			actionError = getErrorMessage(err, 'Billing portal could not be opened.');
			portalLoading = false;
		}
	}
	async function handleTopUp() {
		if (topUpLoading || !(topUpResult || canSubmitTopUp)) {
			return;
		}

		topUpLoading = true;
		topUpError = '';
		try {
			if (!topUpResult) {
				topUpResult = await idempotent(purchaseCredits, 'billing.purchaseCredits', {
					projectId,
					credits: packs * billingUnits
				});
			}
			if (topUpResult.url) {
				window.location.href = topUpResult.url;
				return;
			}
			window.location.reload();
		} catch (err) {
			topUpError = topUpResult
				? 'Your purchase was submitted. Select Continue to open the payment page or refresh your balance.'
				: getErrorMessage(
						err,
						'The purchase could not be confirmed. Check your billing history before trying again.'
					);
			topUpLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Billing / Stack</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	<BillingSetupDialog
		bind:open={billingSetupOpen}
		{projectId}
		{billingReady}
		{canManageBilling}
		returnTo={projectBillingPath(projectId)}
	/>
	{#if credits}
		<Dialog.Root bind:open={buyCreditsOpen}>
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

				{#if packPrice !== null}
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
								bind:value={topUpAmountInput}
								disabled={topUpLoading}
								class="border-border bg-background pr-12 pl-7 text-foreground tabular-nums"
							/>
							<span
								class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
							>
								USD
							</span>
						</div>
						<div class="flex gap-1.5">
							{#each topUpPresets as preset (preset)}
								<button
									type="button"
									disabled={topUpLoading}
									onclick={() => (topUpAmountInput = String(preset))}
									class="rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors {topUpAmountValid &&
									topUpAmount === preset
										? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
										: 'border-border/60 text-muted-foreground hover:bg-muted/50'}"
								>
									${preset}
								</button>
							{/each}
						</div>
					</div>

					<div class="rounded-md border border-border/60 bg-background/40">
						{#if balanceValue !== null}
							<div class="flex items-center justify-between px-3.5 py-2.5 text-sm">
								<span class="text-muted-foreground">New balance</span>
								<span class="font-medium text-foreground tabular-nums">
									{formatUsd(canSubmitTopUp ? balanceValue + billedNow : balanceValue)}
								</span>
							</div>
						{/if}
						<div
							class="flex items-center justify-between px-3.5 py-2.5 text-sm {balanceValue === null
								? ''
								: 'border-t border-border/40'}"
						>
							<span class="text-muted-foreground">Billed now</span>
							<span class="font-semibold text-foreground tabular-nums">
								{canSubmitTopUp ? formatUsd(billedNow) : '-'}
							</span>
						</div>
					</div>

					{#if roundedUp}
						<p class="text-xs text-muted-foreground">
							Credits are sold in {formatUsd(packPrice)} increments, so the amount is rounded up to
							{formatUsd(billedNow)}.
						</p>
					{/if}
				{:else}
					<div class="rounded-md border border-border/60 bg-background/40 px-3.5 py-2.5">
						<p class="text-sm text-muted-foreground">
							Credit pricing is unavailable right now. Try again in a moment.
						</p>
					</div>
				{/if}

				{#if topUpError}
					<div
						role="alert"
						class="rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
					>
						{topUpError}
					</div>
				{/if}

				<Dialog.Footer>
					<Button variant="outline" size="sm" onclick={() => (buyCreditsOpen = false)}
						>Not now</Button
					>
					<Button
						size="sm"
						onclick={handleTopUp}
						disabled={topUpLoading || !(topUpResult || canSubmitTopUp)}
					>
						{#if topUpLoading}
							<Loader2 class="size-3.5 animate-spin" />
						{/if}
						{#if topUpResult}
							Continue
						{:else}
							{canSubmitTopUp ? `Top-up ${formatUsd(billedNow)}` : 'Top-up credits'}
						{/if}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}

	<div class="flex h-12 shrink-0 items-center border-b border-border px-5">
		<div class="flex items-center gap-2">
			<CreditCard class="size-4 text-muted-foreground" />
			<span class="text-sm font-semibold text-foreground">Billing</span>
		</div>
	</div>

	{#if actionError}
		<div
			class="border-b border-red-300 bg-red-100 px-5 py-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300"
		>
			{actionError}
		</div>
	{/if}

	<div class="flex-1 overflow-auto">
		{#snippet resourceRows()}
			{#if activeResources.length}
				<div class="mt-4 divide-y divide-border/40 rounded-md border border-border/60">
					{#each activeResources as resource (resource.id)}
						<div
							class="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/20 border-l-2 border-l-blue-500/60"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60"
								>
									<Server class="size-3.5 text-muted-foreground" />
								</div>
								<div>
									<p class="text-sm font-medium text-foreground">{resource.label}</p>
									<p class="text-xs text-muted-foreground">VPS</p>
								</div>
							</div>
							<div class="text-right">
								<p class="text-sm text-foreground tabular-nums">{resource.count} active</p>
								<p class="text-xs text-muted-foreground tabular-nums">
									{formatDecimal(resource.hours)}
									hrs
									{#if resource.cost !== null}
										· {formatUsd(resource.cost)} est.
									{/if}
								</p>
							</div>
						</div>
					{/each}
				</div>
			{:else if billing.activeResourceCount > 0}
				<div class="mt-4 rounded-md border border-border/60 bg-background/30 p-5 text-center">
					<p class="text-sm text-muted-foreground">
						You have {billing.activeResourceCount} active
						{billing.activeResourceCount === 1 ? 'resource' : 'resources'}.
					</p>
				</div>
			{:else}
				<div class="mt-4 rounded-md border border-border/60 bg-background/30 p-8 text-center">
					<p class="text-sm text-muted-foreground">No active resources right now.</p>
				</div>
			{/if}
		{/snippet}

		<div class="mx-auto max-w-6xl px-6 py-8">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<h1 class="text-xl font-semibold text-foreground">Billing</h1>
				<div class="flex items-center gap-2">
					{#if canBuyCredits}
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
							onclick={() => (buyCreditsOpen = true)}
						>
							<DollarSign class="size-3.5" />
							Top-up credits
						</button>
					{/if}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
						onclick={handleBillingAction}
						disabled={portalLoading}
					>
						<CreditCard class="size-3.5" />
						{billingActionLabel}
					</button>
				</div>
			</div>

			<div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div class="rounded-lg border border-border/60 bg-background/40 p-4">
					<div class="flex items-center gap-2">
						<Server class="size-4 text-blue-400" />
						<p class="text-xs font-medium text-muted-foreground">Active servers</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
						{activeServers}
					</p>
				</div>
				<div class="rounded-lg border border-border/60 bg-background/40 p-4">
					<div class="flex items-center gap-2">
						<Cpu class="size-4 text-violet-400" />
						<p class="text-xs font-medium text-muted-foreground">Compute hours</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
						{formatDecimal(totalHours)}
						hrs
					</p>
				</div>
				<div class="rounded-lg border border-border/60 bg-background/40 p-4">
					<div class="flex items-center gap-2">
						<CreditCard class="size-4 text-emerald-400" />
						<p class="text-xs font-medium text-muted-foreground">Est. cost</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
						{hasCost ? formatUsd(totalCost) : '-'}
					</p>
				</div>
				{#if credits}
					<div class="rounded-lg border border-border/60 bg-background/40 p-4">
						<div class="flex items-center gap-2">
							<DollarSign class="size-4 text-amber-400" />
							<p class="text-xs font-medium text-muted-foreground">Credits</p>
						</div>
						<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
							{balanceValue === null ? formatDecimal(credits.remaining) : formatUsd(balanceValue)}
						</p>
						{#if credits.estimatedOverageCost !== null && credits.estimatedOverageCost > 0}
							<p class="mt-0.5 text-xs text-muted-foreground tabular-nums">
								{formatUsd(credits.estimatedOverageCost)}
								pay-as-you-go this cycle
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="mt-10">
				<h2 class="text-sm font-semibold text-foreground">Active resources</h2>
				{@render resourceRows()}
			</div>

			<div class="mt-10">
				<h2 class="text-sm font-semibold text-foreground">Invoices</h2>
				{#if invoices.length}
					<div class="-mx-6 -my-2 mt-2 overflow-x-auto whitespace-nowrap">
						<div class="inline-block min-w-full px-6 py-2 align-middle">
							<table class="w-full">
								<thead>
									<tr>
										<th
											class="py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
										>
											Date
										</th>
										<th
											class="py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground"
										>
											Status
										</th>
										<th
											class="py-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground"
										>
											Amount
										</th>
										<th class="py-2">
											<span class="sr-only">View invoice</span>
										</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-border/40">
									{#each invoices as invoice (invoice.stripeId)}
										<tr>
											<td class="py-3 pr-4 text-sm text-foreground">
												{formatDate(invoice.createdAt)}
											</td>
											<td class="py-3 pr-4">
												<span
													class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {statusBadgeClass[
														invoiceTone(invoice.status)
													]}"
												>
													{friendlyLabel(invoice.status, 'Unknown')}
												</span>
											</td>
											<td class="py-3 text-right text-sm text-foreground tabular-nums">
												{formatCurrency(invoice.total, invoice.currency)}
											</td>
											<td class="py-3 pl-4 text-right text-sm">
												{#if invoice.hostedInvoiceUrl}
													<a
														href={invoice.hostedInvoiceUrl}
														target="_blank"
														rel="noreferrer"
														class="font-medium text-foreground hover:underline"
													>
														View
													</a>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{:else}
					<div class="mt-4 rounded-md border border-border/60 bg-background/30 p-8 text-center">
						<p class="text-sm text-muted-foreground">No invoices yet.</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
