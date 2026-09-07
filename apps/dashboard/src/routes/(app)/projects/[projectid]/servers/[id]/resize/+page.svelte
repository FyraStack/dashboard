<script lang="ts">
	import type { PageProps } from './$types';
	import { invalidate } from '$app/navigation';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { resizeVm } from '$lib/remote/vms.remote';
	import { getErrorMessage } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import Loader2 from '~icons/lucide/loader-2';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let vmTypes = $derived(data.vmTypes ?? []);
	let currentVmTypeId = $derived(data.currentVmTypeId ?? null);
	let currentVmType = $derived(data.currentVmType ?? null);
	let resizingId = $state<string | null>(null);
	let resizeError = $state('');

	function formatRam(mb: number): string {
		if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB`;
		return `${mb}MB`;
	}

	function isCurrent(planId: string): boolean {
		if (currentVmTypeId) return planId === currentVmTypeId;
		const plan = vmTypes.find((t) => t.id === planId);
		return plan?.name === selectedServer.plan;
	}

	function isShrink(planStorage: number): boolean {
		if (currentVmType) return planStorage < currentVmType.storageAmount;
		return false;
	}

	async function handleResize(plan: {
		id: string;
		name: string;
		cores: number;
		ramCapacity: number;
		storageAmount: number;
		cap: string;
	}) {
		if (resizingId || isCurrent(plan.id) || isShrink(plan.storageAmount)) return;
		const ok = await confirmDestructive({
			title: `Resize to ${plan.name}?`,
			description: `This changes ${selectedServer.name} to ${plan.cores} vCPU, ${formatRam(plan.ramCapacity)} RAM, ${plan.storageAmount}GB disk. CPU and memory changes may require a reboot to take effect. Disk can only grow and cannot be undone — expand the filesystem inside the guest afterwards.`,
			confirmLabel: `Resize to ${plan.name}`
		});
		if (!ok) return;

		resizingId = plan.id;
		resizeError = '';
		try {
			await resizeVm({ vmId: selectedServer.id, vmTypeId: plan.id });
			toast.success(`Resizing to ${plan.name}`);
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
			Change the plan for {selectedServer.name}. Current plan: {currentVmType?.name ??
				selectedServer.plan}
			{#if currentVmType}
				({currentVmType.cores} vCPU • {formatRam(currentVmType.ramCapacity)} RAM • {currentVmType.storageAmount}GB
				disk)
			{/if}
		</p>
	</div>
	<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
		CPU and memory changes may require a reboot to take effect. Disk can only be grown, never shrunk
		— expand the filesystem inside the guest afterwards.
	</p>
	{#if resizeError}
		<p
			class="border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-400"
		>
			{resizeError}
		</p>
	{/if}
	{#if vmTypes.length === 0}
		<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
			No plans available.
		</p>
	{:else}
		<div class="grid gap-3 md:grid-cols-2">
			{#each vmTypes as plan (plan.id)}
				{@const current = isCurrent(plan.id)}
				{@const shrink = !current && isShrink(plan.storageAmount)}
				<div class="border border-border bg-background/40 p-4 {current ? 'border-red-500' : ''}">
					<div class="flex items-center justify-between">
						<h3 class="text-sm font-semibold text-foreground">{plan.name}</h3>
						<span class="text-sm text-muted-foreground">${plan.cap}/mo</span>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						{plan.cores} vCPU • {formatRam(plan.ramCapacity)} RAM • {plan.storageAmount}GB disk
					</p>
					{#if shrink}
						<p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
							Disk shrink not supported — cannot go below {currentVmType?.storageAmount}GB.
						</p>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="mt-4 h-7 text-xs"
						disabled={current ||
							shrink ||
							resizingId !== null ||
							selectedServer.status === 'provisioning' ||
							selectedServer.status === 'deleting'}
						onclick={() => handleResize(plan)}
					>
						{#if resizingId === plan.id}
							<Loader2 class="mr-1.5 h-3 w-3 animate-spin" />Resizing...
						{:else if current}
							Current Plan
						{:else}
							Resize
						{/if}
					</Button>
				</div>
			{/each}
		</div>
	{/if}
</div>
