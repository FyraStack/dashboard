<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidate } from '$app/navigation';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { getVm, resizeVm } from '$lib/remote/vms.remote';
	import { listVmTypes } from '$lib/remote/vm-types.remote';
	import { findPlanDowngrades } from '$lib/vm-plans';
	import { getErrorMessage } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { formatBytes } from '../../lib/server-summary';
	import Loader2 from '~icons/lucide/loader-2';

	type VmPlan = Awaited<ReturnType<typeof listVmTypes>>[number];

	const resizeCaveats =
		'You cannot resize your server to a smaller size. For a resize to take effect, you will need to restart your server. You will need to manually expand your filesystem after a server resize.';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let resizingId = $state<string | null>(null);
	let resizeError = $state('');
	let serverBusy = $derived(
		selectedServer.status === 'provisioning' || selectedServer.status === 'deleting'
	);

	function formatRam(mb: number): string {
		return formatBytes(mb * 1024 * 1024);
	}

	function describePlan(plan: VmPlan): string {
		return `${plan.cores} vCPU, ${formatRam(plan.ramCapacity)} RAM, ${plan.storageAmount}GB disk`;
	}

	function isDowngrade(plan: VmPlan): boolean {
		return data.vmType !== null && findPlanDowngrades(data.vmType, plan).length > 0;
	}

	async function handleResize(plan: VmPlan) {
		if (resizingId || plan.id === data.vmTypeId || isDowngrade(plan)) return;
		const ok = await confirmDestructive({
			title: `Resize to ${plan.name}?`,
			description: `This changes ${selectedServer.name} to ${describePlan(plan)}. ${resizeCaveats}`,
			confirmLabel: `Resize to ${plan.name}`
		});
		if (!ok) return;

		resizingId = plan.id;
		resizeError = '';
		try {
			await resizeVm({ vmId: selectedServer.id, vmTypeId: plan.id }).updates(
				getVm({ vmId: selectedServer.id })
			);
			toast.success(`Resized to ${plan.name}. Restart the server for the change to take effect.`);
			await invalidate('project:vms');
		} catch (err) {
			resizeError = getErrorMessage(err, 'Failed to resize server.');
			toast.error(resizeError);
		} finally {
			resizingId = null;
		}
	}
</script>

<div class="space-y-4 p-5">
	<div>
		<h2 class="text-sm font-semibold text-foreground">Resize Server</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Change the plan for {selectedServer.name}. Current plan: {data.vmType?.name ??
				selectedServer.plan}
			{#if data.vmType}
				({data.vmType.cores} vCPU • {formatRam(data.vmType.ramCapacity)} RAM • {data.vmType
					.storageAmount}GB disk)
			{/if}
		</p>
	</div>
	<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
		{resizeCaveats}
	</p>
	{#if resizeError}
		<p
			class="border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-400"
		>
			{resizeError}
		</p>
	{/if}
	{#if data.vmTypes.length === 0}
		<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
			No plans available.
		</p>
	{:else}
		<div class="grid gap-3 md:grid-cols-2">
			{#each data.vmTypes as plan (plan.id)}
				{@const current = plan.id === data.vmTypeId}
				{@const downgrade = !current && isDowngrade(plan)}
				<div
					class="border border-border bg-background/40 p-4 {current
						? 'border-red-500'
						: ''} {downgrade ? 'pointer-events-none opacity-40' : ''}"
				>
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-foreground">{plan.name}</h3>
						<span class="text-sm text-muted-foreground">${plan.cap}/mo</span>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						{plan.cores} vCPU • {formatRam(plan.ramCapacity)} RAM • {plan.storageAmount}GB disk
					</p>
					<Button
						variant="outline"
						size="sm"
						class="mt-4 h-7 text-xs"
						disabled={current || downgrade || resizingId !== null || serverBusy}
						onclick={() => handleResize(plan)}
					>
						{#if resizingId === plan.id}
							<Loader2 class="mr-1.5 h-3 w-3 animate-spin" />Resizing...
						{:else if current}
							Current Plan
						{:else if downgrade}
							Not Supported
						{:else}
							Resize
						{/if}
					</Button>
				</div>
			{/each}
		</div>
	{/if}
</div>
