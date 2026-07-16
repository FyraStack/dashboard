<script lang="ts">
	import { CreditCard, Info, Loader2, ShieldAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { openBillingPortal, setupProjectBillingPayment } from '$lib/remote/billing.remote';
	import { getErrorMessage } from '$lib/utils';

	type Mode = 'server-create' | 'billing-page';

	let {
		open = $bindable(false),
		projectId,
		billingReady = false,
		canManageBilling = false,
		mode = 'billing-page',
		returnTo = `/projects/${projectId}/billing`
	}: {
		open?: boolean;
		projectId: string;
		billingReady?: boolean;
		canManageBilling?: boolean;
		mode?: Mode;
		returnTo?: string;
	} = $props();

	let loading = $state(false);
	let actionError = $state('');
	let discountCode = $state('');

	const title = $derived(billingReady ? 'Manage billing' : 'Set up billing');
	const description = $derived(
		billingReady
			? 'Manage payment methods, invoices, and project billing settings.'
			: mode === 'server-create'
				? 'This project needs a payment method before servers can be created.'
				: 'This project needs a payment method before resources can be created.'
	);
	const primaryLabel = $derived(billingReady ? 'Open billing portal' : 'Add payment method');

	async function handlePrimaryAction() {
		if (!projectId || loading || !canManageBilling) return;

		loading = true;
		actionError = '';
		try {
			const code = discountCode.trim();
			const result = billingReady
				? await openBillingPortal({ projectId })
				: await setupProjectBillingPayment({
						projectId,
						returnTo,
						...(code ? { discountCode: code } : {})
					});
			window.location.href = result.url;
		} catch (err) {
			actionError = getErrorMessage(err, 'Billing could not be opened. Try again.');
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
				{#if canManageBilling}
					<CreditCard class="size-5 text-red-300" />
				{:else}
					<ShieldAlert class="size-5 text-amber-300" />
				{/if}
			</div>
			<Dialog.Title>{canManageBilling ? title : 'Billing setup required'}</Dialog.Title>
			<Dialog.Description class="text-muted-foreground">
				{#if canManageBilling}
					{description}
				{:else}
					A project owner must set up billing before servers can be created.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if !billingReady}
			<div class="flex gap-3 rounded-lg border border-border/80 bg-background/60 p-4">
				<Info class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p class="text-sm text-muted-foreground">
					This payment method is used for this project only. You can change it from Billing anytime.
				</p>
			</div>

			{#if canManageBilling}
				<div class="space-y-1.5">
					<Label for="billing-discount-code" class="text-sm text-muted-foreground">
						Discount code <span class="text-muted-foreground">(optional)</span>
					</Label>
					<Input
						id="billing-discount-code"
						bind:value={discountCode}
						placeholder="Enter code"
						autocomplete="off"
						spellcheck={false}
						disabled={loading}
						class="border-border bg-background text-foreground placeholder:text-muted-foreground"
					/>
				</div>
			{/if}
		{/if}

		{#if actionError}
			<div
				class="rounded-md border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
			>
				{actionError}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>
				{canManageBilling ? 'Not now' : 'Close'}
			</Button>
			{#if canManageBilling}
				<Button size="sm" onclick={handlePrimaryAction} disabled={loading}>
					{#if loading}
						<Loader2 class="size-3.5 animate-spin" />
					{/if}
					{primaryLabel}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
