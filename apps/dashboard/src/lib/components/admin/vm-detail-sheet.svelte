<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import * as Sheet from '$lib/components/ui/sheet';
	import { getVmBillingUsage, type VmBillingUsage } from '$lib/remote/admin-billing.remote';
	import type { AdminVm } from '$lib/remote/admin-vms.remote';
	import type { AdminState } from '$lib/state/admin.svelte';
	import { getErrorMessage, runQuery } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Activity from '~icons/nucleo/activity';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Calendar from '~icons/nucleo/calendar';
	import Clock from '~icons/nucleo/clock';
	import Cpu from '~icons/nucleo/cpu';
	import CreditCard from '~icons/nucleo/credit-card';
	import Globe from '~icons/nucleo/globe';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Hash from '~icons/nucleo/hash';
	import Play from '~icons/nucleo/play';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Server from '~icons/nucleo/server';
	import ShieldOff from '~icons/nucleo/shield-off';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';

	let {
		open = false,
		vm = null,
		admin,
		onClose,
		onReverse,
		onDelete
	}: {
		open?: boolean;
		vm?: AdminVm | null;
		admin: AdminState;
		onClose: () => void;
		onReverse: (vm: AdminVm) => void;
		onDelete: (vm: AdminVm) => void;
	} = $props();

	let usage = $state<VmBillingUsage | null>(null);
	let usageLoading = $state(false);
	let usageError = $state('');
	let usageRequest = 0;
	let loadedVmId = '';

	$effect(() => {
		if (!open) {
			loadedVmId = '';
			return;
		}
		const target = vm;
		if (!target || loadedVmId === target.id) return;
		loadedVmId = target.id;
		void loadUsage(target.id);
	});

	async function loadUsage(vmId: string) {
		const current = ++usageRequest;
		usageLoading = true;
		usageError = '';
		usage = null;
		try {
			const now = new Date();
			const periodStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
			const result = await runQuery(
				getVmBillingUsage({ vmId, periodStart, periodEnd: Date.now() })
			);
			if (current !== usageRequest) return;
			usage = result;
		} catch (err) {
			if (current !== usageRequest) return;
			usageError = getErrorMessage(err, 'Failed to load billed usage');
		} finally {
			if (current === usageRequest) usageLoading = false;
		}
	}

	function statusInfo(target: AdminVm) {
		if (!target.active)
			return { label: 'deleted', class: 'border-ring/20 bg-muted/30 text-muted-foreground' };
		if (target.status === 'deleting')
			return { label: 'deleting', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (target.status === 'error')
			return { label: 'error', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (target.status === 'provisioning')
			return { label: 'provisioning', class: 'border-sky-500/20 bg-sky-500/10 text-sky-400' };
		if (target.liveStatus === 'running')
			return {
				label: 'running',
				class: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
			};
		if (target.liveStatus === 'paused')
			return { label: 'paused', class: 'border-amber-500/20 bg-amber-500/10 text-amber-400' };
		return { label: 'stopped', class: 'border-ring/20 bg-muted/30 text-muted-foreground' };
	}

	function formatUptime(seconds: number) {
		if (seconds <= 0) return '-';
		const days = Math.floor(seconds / 86_400);
		const hours = Math.floor((seconds % 86_400) / 3_600);
		const minutes = Math.floor((seconds % 3_600) / 60);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	function formatDateTime(timestamp: number) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(timestamp)
		);
	}

	function formatGiB(bytes: number) {
		return `${(bytes / 1_073_741_824).toFixed(1)} GiB`;
	}

	function formatPercent(fraction: number) {
		return `${(fraction * 100).toFixed(1)}%`;
	}
</script>

<Sheet.Root {open} onOpenChange={(value) => !value && onClose()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if vm}
			{@const info = statusInfo(vm)}
			{@const saving = admin.adminVmSaving[vm.id]}
			<div class="flex flex-col gap-6">
				<div class="flex items-start justify-between gap-3 pr-8">
					<div class="flex min-w-0 flex-col gap-0.5">
						<span class="truncate text-base font-semibold text-foreground">{vm.name}</span>
						<span class="truncate font-mono text-xs text-muted-foreground">
							{vm.lastKnownIpv4 ?? vm.lastKnownIpv6 ?? vm.id}
						</span>
					</div>
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {info.class}"
					>
						{info.label}
					</span>
				</div>

				{#if vm.active}
					<div class="grid grid-cols-4 gap-2">
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							disabled={Boolean(saving) || vm.liveStatus === 'running'}
							onclick={() => admin.adminVmPower(vm.id, 'start')}
						>
							{#if saving === 'start'}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Play
									class="h-3 w-3 text-emerald-400"
								/>{/if}
							Start
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							disabled={Boolean(saving) || vm.liveStatus !== 'running'}
							onclick={() => admin.adminVmPower(vm.id, 'stop')}
						>
							{#if saving === 'stop'}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Power
									class="h-3 w-3"
								/>{/if}
							Stop
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							disabled={Boolean(saving) || vm.liveStatus !== 'running'}
							onclick={() => admin.adminVmPower(vm.id, 'reboot')}
						>
							{#if saving === 'reboot'}<Loader2 class="h-3 w-3 animate-spin" />{:else}<RotateCw
									class="h-3 w-3 text-sky-400"
								/>{/if}
							Reboot
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
							disabled={Boolean(saving) || vm.liveStatus !== 'running'}
							onclick={() => admin.adminVmPower(vm.id, 'kill')}
						>
							{#if saving === 'kill'}<Loader2 class="h-3 w-3 animate-spin" />{:else}<PowerOff
									class="h-3 w-3 text-amber-400"
								/>{/if}
							Kill
						</Button>
					</div>
				{/if}

				{#if vm.statusError}
					<div
						class="flex items-start gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-300"
					>
						<AlertTriangle class="mt-0.5 size-4 shrink-0 text-red-400" />
						{vm.statusError}
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Diagnostics</span
					>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Activity class="h-3 w-3" />Live status
						</span>
						<span class="text-xs text-foreground">{vm.liveStatus ?? '-'}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Clock class="h-3 w-3" />Uptime
						</span>
						<span class="text-xs text-muted-foreground">
							{vm.liveStatus === 'running' ? formatUptime(vm.uptime) : '-'}
						</span>
					</div>
					{#if vm.cpuUsage != null}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Cpu class="h-3 w-3" />CPU
							</span>
							<span class="text-xs text-muted-foreground">{formatPercent(vm.cpuUsage)}</span>
						</div>
					{/if}
					{#if vm.memoryUsageBytes != null && vm.memoryTotalBytes != null && vm.memoryTotalBytes > 0}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<HardDrive class="h-3 w-3" />Memory
							</span>
							<span class="text-xs text-muted-foreground">
								{formatGiB(vm.memoryUsageBytes)} / {formatGiB(vm.memoryTotalBytes)}
							</span>
						</div>
					{/if}
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Server class="h-3 w-3" />Node
						</span>
						<span class="font-mono text-xs text-muted-foreground">{vm.proxmoxNode ?? '-'}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Hash class="h-3 w-3" />Proxmox VMID
						</span>
						<span class="font-mono text-xs text-muted-foreground">{vm.proxmoxId ?? '-'}</span>
					</div>
					{#if vm.lastKnownAt}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Clock class="h-3 w-3" />Last seen
							</span>
							<span class="text-xs text-muted-foreground">{formatDateTime(vm.lastKnownAt)}</span>
						</div>
					{/if}
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Globe class="h-3 w-3" />IPv4
						</span>
						<span class="font-mono text-xs text-muted-foreground">{vm.lastKnownIpv4 ?? '-'}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Globe class="h-3 w-3" />IPv6
						</span>
						<span class="max-w-56 truncate font-mono text-xs text-muted-foreground">
							{vm.lastKnownIpv6 ?? '-'}
						</span>
					</div>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Type</span
					>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Cpu class="h-3 w-3" />Plan
						</span>
						<span class="text-xs text-foreground">{vm.vmTypeName ?? '-'}</span>
					</div>
					{#if vm.vmTypeCores}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Server class="h-3 w-3" />Resources
							</span>
							<span class="text-xs text-muted-foreground">
								{vm.vmTypeCores}c · {vm.vmTypeRamCapacity} MB · {vm.vmTypeStorageAmount} GB
							</span>
						</div>
					{/if}
					{#if vm.vmTypeRate}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<CreditCard class="h-3 w-3" />Rate
							</span>
							<span class="text-xs text-muted-foreground">${vm.vmTypeRate}/hr</span>
						</div>
					{/if}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Project</span
					>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Server class="h-3 w-3" />Project
						</span>
						{#if vm.projectId}
							<a
								class="text-xs text-foreground hover:underline"
								href={resolve(`/admin/projects/${vm.projectId}`)}
							>
								{vm.projectName ?? vm.projectId}
							</a>
						{:else}
							<span class="text-xs text-foreground">-</span>
						{/if}
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<User class="h-3 w-3" />Owner
						</span>
						<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
							{vm.ownerEmail ?? '-'}
							{#if vm.ownerBillingExempt || vm.projectBillingExempt}
								<span
									class="inline-flex items-center gap-0.5 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1 py-px text-[10px] font-medium text-violet-400"
								>
									<ShieldOff class="h-2.5 w-2.5" />No billing
								</span>
							{/if}
						</span>
					</div>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Billing this month</span
					>
					{#if usageLoading}
						<div class="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
							Computing billed usage...
						</div>
					{:else if usageError}
						<div
							class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-xs text-red-400"
						>
							<AlertTriangle class="size-4 shrink-0" />{usageError}
						</div>
					{:else if usage}
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Billed</span>
								<span class="text-foreground">{usage.billedHours.toFixed(2)} unit-hours</span>
							</div>
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Reversed</span>
								<span class="text-foreground">{usage.reversedHours.toFixed(2)} unit-hours</span>
							</div>
							{#if usage.estimatedAmount != null}
								<div class="flex items-center justify-between text-xs">
									<span class="text-muted-foreground">Estimated charge (before caps)</span>
									<span class="text-foreground">${usage.estimatedAmount.toFixed(2)}</span>
								</div>
							{/if}
						</div>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="w-fit gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={() => onReverse(vm)}
					>
						<CreditCard class="h-3 w-3 text-violet-400" />
						Reverse billing
					</Button>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Record</span
					>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Hash class="h-3 w-3" />VM ID
						</span>
						<span class="font-mono text-xs text-muted-foreground">{vm.id}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Calendar class="h-3 w-3" />Created
						</span>
						<span class="text-xs text-muted-foreground">{formatDateTime(vm.createdAt)}</span>
					</div>
					{#if vm.deletedAt}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Trash2 class="h-3 w-3" />Deleted
							</span>
							<span class="text-xs text-muted-foreground">{formatDateTime(vm.deletedAt)}</span>
						</div>
					{/if}
				</div>

				{#if vm.active}
					<Separator class="bg-muted" />

					<div class="flex flex-col gap-3 rounded-sm border border-red-500/20 bg-red-500/5 p-3">
						<div class="flex items-start gap-2">
							<Trash2 class="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
							<div class="flex flex-col gap-1">
								<span class="text-sm font-medium text-red-300">Delete server</span>
								<span class="text-[11px] leading-4 text-red-300/70">
									Deprovisions the server in Proxmox, releases its networking, and records final
									usage.
								</span>
							</div>
						</div>
						<Button
							variant="destructive"
							size="sm"
							class="w-fit gap-1.5 text-xs"
							onclick={() => onDelete(vm)}
							disabled={Boolean(saving)}
						>
							<Trash2 class="h-3 w-3" />
							Delete server
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
