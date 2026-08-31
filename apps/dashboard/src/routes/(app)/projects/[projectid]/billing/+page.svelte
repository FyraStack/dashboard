<script lang="ts">
	import BillingSetupDialog from '$lib/components/billing-setup-dialog.svelte';
	import BuyCreditsDialog from '$lib/components/buy-credits-dialog.svelte';
	import { openBillingPortal } from '$lib/remote/billing.remote';
	import { getErrorMessage } from '$lib/utils';
	import DollarSign from '~icons/nucleo/dollar-sign';
	import Cpu from '~icons/nucleo/cpu';
	import CreditCard from '~icons/nucleo/credit-card';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Server from '~icons/nucleo/server';

	type DateValue = Date | number | string | null | undefined;

	type CustomerDetails = Record<string, unknown>;

	type ActiveResource = Record<string, unknown> & {
		id?: string;
		label?: string;
		name?: string;
		productLabel?: string;
		productName?: string;
		resourceType?: string;
		type?: string;
		count?: number;
		hours?: number;
		cost?: number | null;
		quantity?: number | string;
		unit?: string;
	};

	type CreditsDetails = {
		remaining?: number;
		usage?: number;
		overageUsage?: number;
		estimatedOverageCost?: number | null;
		prepaidPrice?: { amount: number | null; billingUnits: number } | null;
	};

	type InvoiceDetails = {
		stripeId: string;
		status: string;
		total: number;
		currency: string;
		createdAt: number;
		hostedInvoiceUrl: string | null;
	};

	type BillingDetails = Record<string, unknown> & {
		activeResourceCount?: number;
		activeResources?: ActiveResource[];
		credits?: CreditsDetails | null;
		customer?: CustomerDetails | null;
		invoices?: InvoiceDetails[];
		lastUpdatedAt?: DateValue;
		setupRequired?: boolean;
		status?: string;
	};

	let { data } = $props();

	let billingSetupOpen = $state(false);
	let buyCreditsOpen = $state(false);
	let portalLoading = $state(false);
	let actionError = $state('');

	const projectId = $derived(data.projectId ?? '');
	const canManageBilling = $derived(Boolean(data.canManageBilling));
	const billing = $derived(data.billing as BillingDetails | null | undefined);
	const billingReady = $derived(billing?.setupRequired === false);
	const activeResources = $derived((billing?.activeResources ?? []) as ActiveResource[]);
	const activeResourceCount = $derived(activeResources.length || billing?.activeResourceCount || 0);
	const activeServers = $derived(
		activeResources.reduce((total, r) => total + (typeof r.count === 'number' ? r.count : 0), 0)
	);
	const totalHours = $derived(
		activeResources.reduce((total, r) => total + (typeof r.hours === 'number' ? r.hours : 0), 0)
	);
	const totalCost = $derived(
		activeResources.reduce((total, r) => total + (typeof r.cost === 'number' ? r.cost : 0), 0)
	);
	const hasCost = $derived(activeResources.some((r) => typeof r.cost === 'number'));
	const credits = $derived(billing?.credits ?? null);
	const invoices = $derived(
		[...(billing?.invoices ?? [])].sort((a, b) => b.createdAt - a.createdAt)
	);
	const canBuyCredits = $derived(Boolean(credits) && canManageBilling && billingReady);
	const creditRate = $derived(
		credits?.prepaidPrice?.amount != null && credits.prepaidPrice.billingUnits > 0
			? credits.prepaidPrice.amount / credits.prepaidPrice.billingUnits
			: null
	);

	function formatCredits(value: number | undefined) {
		return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(
			typeof value === 'number' ? value : 0
		);
	}

	function readString(source: Record<string, unknown> | null | undefined, key: string) {
		const value = source?.[key];
		return typeof value === 'string' && value.trim() ? value : undefined;
	}

	function formatHours(value: number | undefined) {
		const hours = typeof value === 'number' ? value : 0;
		return `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(hours)} hrs`;
	}

	function formatCost(value: number | null | undefined) {
		if (typeof value !== 'number') return null;
		return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(value);
	}

	function formatInvoiceDate(timestamp: number) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(timestamp));
	}

	function formatInvoiceTotal(invoice: InvoiceDetails) {
		try {
			return new Intl.NumberFormat('en', {
				style: 'currency',
				currency: invoice.currency.toUpperCase()
			}).format(invoice.total);
		} catch {
			return `${invoice.total} ${invoice.currency.toUpperCase()}`;
		}
	}

	function invoiceStatusClasses(status: string) {
		const s = status.toLowerCase();
		if (s === 'paid') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
		if (s === 'open' || s === 'draft') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
		return 'bg-muted/60 text-muted-foreground';
	}

	function friendlyLabel(value: unknown, fallback: string) {
		if (typeof value !== 'string' || !value.trim()) return fallback;
		return value
			.replace(/[_-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\b\w/g, (letter) => letter.toUpperCase());
	}

	function resourceLabel(resource: ActiveResource) {
		const label = resource.label ?? resource.name ?? resource.productLabel ?? resource.productName;
		return typeof label === 'string' && label.trim() ? label : 'Resource';
	}

	function resourceTypeLabel(resource: ActiveResource) {
		const type = (resource.resourceType ?? resource.type ?? '').toLowerCase();
		if (type === 'vm') return 'VPS';
		return friendlyLabel(resource.resourceType ?? resource.type, 'Resource');
	}

	function activeResourceKey(resource: ActiveResource, index: number) {
		return String(
			resource.id ?? `${resource.label ?? resource.name ?? resource.type ?? 'resource'}-${index}`
		);
	}

	function resourceIcon(type: string | undefined) {
		if (!type) return Server;
		const t = type.toLowerCase();
		if (t.includes('volume') || t.includes('storage')) return HardDrive;
		return Server;
	}

	function resourceStripe(resource: ActiveResource) {
		const t = (resource.resourceType ?? resource.type ?? '').toLowerCase();
		if (t === 'vm') return 'border-l-2 border-l-blue-500/60';
		if (t === 'volume') return 'border-l-2 border-l-violet-500/60';
		return '';
	}

	async function handleBillingAction() {
		if (!billingReady) {
			billingSetupOpen = true;
			return;
		}
		if (!projectId || portalLoading) return;

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
		mode="billing-page"
		returnTo={`/projects/${projectId}/billing`}
	/>
	{#if credits}
		<BuyCreditsDialog
			bind:open={buyCreditsOpen}
			{projectId}
			prepaidPrice={credits.prepaidPrice ?? null}
			remaining={credits.remaining}
		/>
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
					{#each activeResources as resource, index (activeResourceKey(resource, index))}
						{@const Icon = resourceIcon(resource.resourceType ?? resource.type)}
						{@const stripe = resourceStripe(resource)}
						{@const costLabel = formatCost(resource.cost)}
						<div
							class="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-muted/20 {stripe}"
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/60"
								>
									<Icon class="size-3.5 text-muted-foreground" />
								</div>
								<div>
									<p class="text-sm font-medium text-foreground">{resourceLabel(resource)}</p>
									<p class="text-xs text-muted-foreground">{resourceTypeLabel(resource)}</p>
								</div>
							</div>
							<div class="text-right">
								<p class="text-sm text-foreground tabular-nums">{resource.count ?? 0} active</p>
								<p class="text-xs text-muted-foreground tabular-nums">
									{formatHours(resource.hours)}{#if costLabel}
										· {costLabel} est.{/if}
								</p>
							</div>
						</div>
					{/each}
				</div>
			{:else if activeResourceCount > 0}
				<div class="mt-4 rounded-md border border-border/60 bg-background/30 p-5 text-center">
					<p class="text-sm text-muted-foreground">
						You have {activeResourceCount} active {activeResourceCount === 1
							? 'resource'
							: 'resources'}.
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
							class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
							onclick={() => (buyCreditsOpen = true)}
						>
							<DollarSign class="size-3.5" />
							Top-up credits
						</button>
					{/if}
					<button
						class="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
						onclick={handleBillingAction}
						disabled={portalLoading}
					>
						<CreditCard class="size-3.5" />
						{portalLoading
							? 'Opening portal...'
							: billingReady
								? 'Open billing portal'
								: 'Set up billing'}
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
						{formatHours(totalHours)}
					</p>
				</div>
				<div class="rounded-lg border border-border/60 bg-background/40 p-4">
					<div class="flex items-center gap-2">
						<CreditCard class="size-4 text-emerald-400" />
						<p class="text-xs font-medium text-muted-foreground">Est. cost</p>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
						{hasCost ? formatCost(totalCost) : '-'}
					</p>
				</div>
				{#if credits}
					<div class="rounded-lg border border-border/60 bg-background/40 p-4">
						<div class="flex items-center gap-2">
							<DollarSign class="size-4 text-amber-400" />
							<p class="text-xs font-medium text-muted-foreground">Credits</p>
						</div>
						<p class="mt-2 text-2xl font-semibold text-foreground tabular-nums">
							{creditRate != null
								? formatCost((credits.remaining ?? 0) * creditRate)
								: formatCredits(credits.remaining)}
						</p>
						{#if typeof credits.estimatedOverageCost === 'number' && credits.estimatedOverageCost > 0}
							<p class="mt-0.5 text-xs text-muted-foreground tabular-nums">
								{formatCost(credits.estimatedOverageCost)} pay-as-you-go this cycle
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
												{formatInvoiceDate(invoice.createdAt)}
											</td>
											<td class="py-3 pr-4">
												<span
													class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {invoiceStatusClasses(
														invoice.status
													)}"
												>
													{friendlyLabel(invoice.status, 'Unknown')}
												</span>
											</td>
											<td class="py-3 text-right text-sm text-foreground tabular-nums">
												{formatInvoiceTotal(invoice)}
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
