<script lang="ts">
	import BillingSetupDialog from '$lib/components/billing-setup-dialog.svelte';
	import { openBillingPortal } from '$lib/remote/billing.remote';
	import { getErrorMessage } from '$lib/utils';
	import { CreditCard, Server, HardDrive, Cpu } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

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

	type BillingDetails = Record<string, unknown> & {
		activeResourceCount?: number;
		activeResources?: ActiveResource[];
		customer?: CustomerDetails | null;
		lastUpdatedAt?: DateValue;
		setupRequired?: boolean;
		status?: string;
	};

	let { data } = $props();

	let billingSetupOpen = $state(false);
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

	<div class="flex h-12 shrink-0 items-center border-b border-gray-800 px-5">
		<div class="flex items-center gap-2">
			<CreditCard class="size-4 text-gray-400" />
			<span class="text-sm font-semibold text-gray-100">Billing</span>
		</div>
	</div>

	{#if actionError}
		<div class="border-b border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-300">
			{actionError}
		</div>
	{/if}

	<div class="flex-1 overflow-auto">
		<div class="mx-auto flex max-w-6xl flex-col gap-0 md:flex-row">
			<!-- Sidebar -->
			<div class="shrink-0 border-b border-gray-800/60 p-6 md:w-72 md:border-r md:border-b-0">
				<div>
					<h1 class="text-lg font-semibold text-gray-50">Billing</h1>
					<p class="mt-1 text-xs text-gray-500">Project billing overview</p>
				</div>

				<div class="mt-6 flex flex-col gap-4">
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<div {...props} class="flex w-fit cursor-help items-center gap-2">
										<Server class="size-3.5 text-blue-400" />
										<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">
											Active servers
										</p>
									</div>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="top">
								<p class="max-w-[16rem]">
									Servers currently running and contributing to this project's bill.
								</p>
							</Tooltip.Content>
						</Tooltip.Root>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">{activeServers}</p>
					</div>
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<div class="flex items-center gap-2">
							<Cpu class="size-3.5 text-violet-400" />
							<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">
								Compute hours
							</p>
						</div>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">
							{formatHours(totalHours)}
						</p>
					</div>
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<div {...props} class="flex w-fit cursor-help items-center gap-2">
										<CreditCard class="size-3.5 text-emerald-400" />
										<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">
											Est. cost
										</p>
									</div>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="top">
								<p class="max-w-[16rem]">
									Estimated from the listed hourly rate. Your final invoice is calculated by the
									billing provider.
								</p>
							</Tooltip.Content>
						</Tooltip.Root>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">
							{hasCost ? formatCost(totalCost) : '—'}
						</p>
					</div>
				</div>

				<div class="mt-6">
					<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">Actions</p>
					<div class="mt-2 flex flex-col gap-1.5">
						<button
							class="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800/50"
							onclick={handleBillingAction}
							disabled={portalLoading}
						>
							<CreditCard class="size-3.5 text-gray-500" />
							{portalLoading
								? 'Opening portal...'
								: billingReady
									? 'Open billing portal'
									: 'Set up billing'}
						</button>
					</div>
				</div>
			</div>

			<!-- Main -->
			<div class="flex-1 p-6">
				<h2 class="text-sm font-semibold text-gray-200">Active resources</h2>
				<p class="mt-0.5 text-xs text-gray-500">Currently contributing to your project bill</p>

				{#if activeResources.length}
					<div class="mt-4 divide-y divide-gray-800/40 rounded-md border border-gray-800/60">
						{#each activeResources as resource, index (activeResourceKey(resource, index))}
							{@const Icon = resourceIcon(resource.resourceType ?? resource.type)}
							{@const stripe = resourceStripe(resource)}
							{@const costLabel = formatCost(resource.cost)}
							<div
								class="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-gray-800/20 {stripe}"
							>
								<div class="flex items-center gap-3">
									<div
										class="flex size-8 shrink-0 items-center justify-center rounded-md bg-gray-800/60"
									>
										<Icon class="size-3.5 text-gray-400" />
									</div>
									<div>
										<p class="text-sm font-medium text-gray-200">{resourceLabel(resource)}</p>
										<p class="text-xs text-gray-500">{resourceTypeLabel(resource)}</p>
									</div>
								</div>
								<div class="text-right">
									<p class="text-sm text-gray-200 tabular-nums">{resource.count ?? 0} active</p>
									<p class="text-xs text-gray-500 tabular-nums">
										{formatHours(resource.hours)}{#if costLabel} · {costLabel} est.{/if}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{:else if activeResourceCount > 0}
					<div class="mt-4 rounded-md border border-gray-800/60 bg-gray-900/30 p-5 text-center">
						<p class="text-sm text-gray-400">
							You have {activeResourceCount} active {activeResourceCount === 1
								? 'resource'
								: 'resources'}.
						</p>
					</div>
				{:else}
					<div class="mt-4 rounded-md border border-gray-800/60 bg-gray-900/30 p-8 text-center">
						<p class="text-sm text-gray-500">No active resources right now.</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
