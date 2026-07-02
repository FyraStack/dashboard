<script lang="ts">
	import { CreditCard, Info, Loader2, ShieldAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
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
			const result = billingReady
				? await openBillingPortal({ projectId })
				: await setupProjectBillingPayment({ projectId, returnTo });
			window.location.href = result.url;
		} catch (err) {
			actionError = getErrorMessage(err, 'Billing could not be opened. Try again.');
			loading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-gray-800 bg-gray-900 text-gray-100 sm:max-w-lg">
		<Dialog.Header>
			<div
				class="mb-2 flex size-10 items-center justify-center rounded-lg border border-gray-800 bg-gray-950"
			>
				{#if canManageBilling}
					<CreditCard class="size-5 text-red-300" />
				{:else}
					<ShieldAlert class="size-5 text-amber-300" />
				{/if}
			</div>
			<Dialog.Title>{canManageBilling ? title : 'Billing setup required'}</Dialog.Title>
			<Dialog.Description class="text-gray-500">
				{#if canManageBilling}
					{description}
				{:else}
					A project owner must set up billing before servers can be created.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if !billingReady}
			<div class="flex gap-3 rounded-lg border border-gray-800/80 bg-gray-950/60 p-4">
				<Info class="mt-0.5 size-4 shrink-0 text-gray-500" />
				<p class="text-sm text-gray-500">
					This payment method is used for this project only. You can change it from Billing anytime.
				</p>
			</div>
		{/if}

		{#if actionError}
			<div class="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
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
