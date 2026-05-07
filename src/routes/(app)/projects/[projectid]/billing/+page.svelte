<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { openBillingPortal } from '$lib/remote/billing.remote';
	import {
		CreditCard,
		Server,
		HardDrive,
		Database,
		Cpu
	} from '@lucide/svelte';

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
		quantity?: number | string;
		unit?: string;
	};

	type BillingDetails = Record<string, unknown> & {
		activeResourceCount?: number;
		activeResources?: ActiveResource[];
		customer?: CustomerDetails | null;
		lastUpdatedAt?: DateValue;
	};

	let { data } = $props();

	let portalLoading = $state(false);
	let actionError = $state(false);

	const projectId = $derived(data.projectId ?? '');
	const billing = $derived(data.billing as BillingDetails | null | undefined);
	const activeResources = $derived((billing?.activeResources ?? []) as ActiveResource[]);
	const activeResourceCount = $derived(activeResources.length || billing?.activeResourceCount || 0);
	const statusLabel = $derived(
		readString(billing, 'statusLabel') ?? (billing?.customer ? 'Ready' : 'Not set up')
	);
	const planLabel = $derived(
		readString(billing, 'planLabel') ??
			readString(billing, 'subscriptionLabel') ??
			'Project billing'
	);
	const computeUnits = $derived(
		activeResources
			.filter((r) => (r.resourceType ?? r.type ?? '').toLowerCase() === 'vm')
			.reduce((sum, r) => sum + (typeof r.quantity === 'number' ? r.quantity : 0), 0)
	);
	const storageGiB = $derived(
		activeResources
			.filter((r) => (r.resourceType ?? r.type ?? '').toLowerCase() === 'volume')
			.reduce((sum, r) => sum + (typeof r.quantity === 'number' ? r.quantity : 0), 0)
	);

	function readString(source: Record<string, unknown> | null | undefined, key: string) {
		const value = source?.[key];
		return typeof value === 'string' && value.trim() ? value : undefined;
	}

	function formatQuantity(value: number | string | undefined, unit?: string) {
		if (typeof value === 'number') {
			const formatted = new Intl.NumberFormat('en').format(value);
			return unit ? `${formatted} ${unit}` : formatted;
		}
		if (typeof value === 'string' && value.trim()) return unit ? `${value} ${unit}` : value;
		return unit ?? '—';
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
		return friendlyLabel(
			resource.label ?? resource.name ?? resource.productLabel ?? resource.productName,
			'Resource'
		);
	}

	function resourceTypeLabel(resource: ActiveResource) {
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

	async function manageBilling() {
		if (!projectId || portalLoading) return;
		portalLoading = true;
		actionError = false;
		try {
			const result = await openBillingPortal({ projectId });
			window.location.href = result.url;
		} catch {
			actionError = true;
			portalLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Billing / Stack</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-12 shrink-0 items-center border-b border-gray-800 px-5">
		<div class="flex items-center gap-2">
			<CreditCard class="size-4 text-gray-400" />
			<span class="text-sm font-semibold text-gray-100">Billing</span>
		</div>
	</div>

	{#if actionError}
		<div class="border-b border-red-900/40 bg-red-950/20 px-5 py-3 text-sm text-red-300">
			We couldn't open your billing portal. Please try again in a moment.
		</div>
	{/if}

	<div class="flex-1 overflow-auto">
		<div class="mx-auto flex max-w-6xl flex-col gap-0 md:flex-row">
			<!-- Sidebar -->
			<div class="shrink-0 border-b border-gray-800/60 p-6 md:w-72 md:border-b-0 md:border-r">
				<div>
					<h1 class="text-lg font-semibold text-gray-50">Billing</h1>
					<p class="mt-1 text-xs text-gray-500">Project billing overview</p>
				</div>

				<div class="mt-6 flex flex-col gap-4">
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<div class="flex items-center gap-2">
							<Cpu class="size-3.5 text-blue-400" />
							<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">Compute units</p>
						</div>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">{computeUnits}</p>
					</div>
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<div class="flex items-center gap-2">
							<HardDrive class="size-3.5 text-violet-400" />
							<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">Storage</p>
						</div>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">{storageGiB} GiB</p>
					</div>
					<div class="rounded-md border border-gray-800/60 bg-gray-900/40 p-3.5">
						<div class="flex items-center gap-2">
							<Server class="size-3.5 text-gray-500" />
							<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">Total resources</p>
						</div>
						<p class="mt-1 text-sm font-semibold text-gray-100 tabular-nums">{activeResourceCount}</p>
					</div>
				</div>

				<div class="mt-6">
					<p class="text-[0.625rem] font-medium tracking-wide text-gray-500 uppercase">Actions</p>
					<div class="mt-2 flex flex-col gap-1.5">
						<button
							class="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800/50"
							onclick={manageBilling}
							disabled={portalLoading}
						>
							<CreditCard class="size-3.5 text-gray-500" />
							{portalLoading ? 'Opening portal…' : 'Open billing portal'}
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
								<span class="text-sm text-gray-300 tabular-nums"
									>{formatQuantity(resource.quantity, resource.unit)}</span
								>
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
