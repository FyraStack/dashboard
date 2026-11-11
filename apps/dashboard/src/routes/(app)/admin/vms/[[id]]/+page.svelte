<script lang="ts">
	import { untrack } from 'svelte';
	import type { IconComponent } from '#lib';
	import { ownerOptions } from '#lib/admin-users.js';
	import {
		AdminVmActions,
		type AdminVmPowerAction,
		type AdminVmStatusKey,
		adminVmServerStatus,
		adminVmStatusKey,
		adminVmStatusKeys,
		describeAdminVmStatusKey
	} from '#lib/admin-vm-actions.svelte.js';
	import { BilledUsage, currentMonthStart } from '#lib/billed-usage.svelte.js';
	import FilterMenu from '#lib/components/admin/filter-menu.svelte';
	import VmActionsMenu from '#lib/components/admin/vm-actions-menu.svelte';
	import VmBillingReversalDialog from '#lib/components/admin/vm-billing-reversal-dialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		formatDate,
		formatDateTime,
		formatDecimal,
		formatGibibytes,
		formatPercent,
		formatUptime,
		formatUsd
	} from '#lib/format.js';
	import type { AdminVm } from '#lib/remote/admin-vms.remote.js';
	import { canPowerOff, canPowerOn, canReboot, statusBadgeClass } from '#lib/vm-status.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
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
	import RefreshCw from '~icons/nucleo/refresh-cw';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import ShieldOff from '~icons/nucleo/shield-off';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const actions = new AdminVmActions();
	const billed = new BilledUsage();

	let search = $state('');
	let ownerFilter = $state('all');
	let typeFilter = $state('all');
	let statusFilter = $state<AdminVmStatusKey | 'all'>('all');
	let showDeleted = $state(false);
	let refreshing = $state(false);

	const vms = $derived(data.adminVms);
	const activeVms = $derived(vms.filter((vm) => vm.active));
	const runningCount = $derived(activeVms.filter((vm) => vm.liveStatus === 'running').length);
	const errorCount = $derived(activeVms.filter((vm) => vm.status === 'error').length);
	const stoppedCount = $derived(activeVms.length - runningCount - errorCount);

	const ownerFilterOptions = $derived(
		ownerOptions(vms).map((owner) => ({
			value: owner.email,
			label: owner.name,
			detail: owner.email
		}))
	);
	const typeFilterOptions = $derived(
		[...new Set(vms.map((vm) => vm.vmTypeName).filter(Boolean) as string[])]
			.sort()
			.map((name) => ({ value: name, label: name }))
	);
	const statusFilterOptions = adminVmStatusKeys.map((key) => ({
		value: key,
		label: describeAdminVmStatusKey(key).label
	}));

	const filteredVms = $derived(
		vms.filter((vm) => {
			if (!(showDeleted || vm.active)) {
				return false;
			}
			if (ownerFilter !== 'all' && vm.ownerEmail !== ownerFilter) {
				return false;
			}
			if (typeFilter !== 'all' && vm.vmTypeName !== typeFilter) {
				return false;
			}
			if (statusFilter !== 'all' && adminVmStatusKey(vm) !== statusFilter) {
				return false;
			}
			const term = search.trim().toLowerCase();
			if (!term) {
				return true;
			}

			return [
				vm.name,
				vm.projectName,
				vm.ownerName,
				vm.ownerEmail,
				vm.lastKnownIpv4,
				vm.id,
				vm.proxmoxId?.toString()
			].some((value) => value?.toLowerCase().includes(term));
		})
	);

	const vmsBase = resolve('admin/vms');
	const selectedVm = $derived(
		page.params.id ? (vms.find((vm) => vm.id === page.params.id) ?? null) : null
	);
	const selectedVmId = $derived(selectedVm?.id);

	$effect(() => {
		const vmId = selectedVmId;
		if (!vmId) {
			billed.reset();
			return;
		}
		untrack(() => billed.load(vmId, currentMonthStart(), Date.now()));
	});

	async function refresh() {
		refreshing = true;
		try {
			await actions.refresh();
		} finally {
			refreshing = false;
		}
	}

	function openVmSheet(vm: AdminVm) {
		goto(resolve(`admin/vms/${vm.id}`), { reset: false });
	}

	function openVmSheetFromRow(event: MouseEvent, vm: AdminVm) {
		const startedInActions =
			event.target instanceof Element && event.target.closest('[data-row-actions]') !== null;
		if (!startedInActions) {
			openVmSheet(vm);
		}
	}

	function closeVmSheet() {
		goto(vmsBase, { reset: false });
	}
</script>

<svelte:head>
	<title>VMs</title>
</svelte:head>

{#snippet statCard(
	Icon: IconComponent,
	tint: string,
	iconClass: string,
	value: number,
	label: string
)}
	<div
		class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
	>
		<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md {tint}">
			<Icon class="h-4 w-4 {iconClass}" />
		</div>
		<div class="flex flex-col">
			<span class="text-lg leading-none font-semibold text-foreground">{value}</span>
			<span class="mt-0.5 text-[10px] text-muted-foreground">{label}</span>
		</div>
	</div>
{/snippet}

{#snippet sectionTitle(
	title: string
)}
	<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</span>
{/snippet}

{#snippet detailRow(
	Icon: IconComponent,
	label: string,
	value: string,
	valueClass = 'text-muted-foreground'
)}
	<div class="flex items-center justify-between">
		<span class="flex items-center gap-2 text-xs text-muted-foreground">
			<Icon class="h-3 w-3" />{label}
		</span>
		<span class="text-xs {valueClass}">{value}</span>
	</div>
{/snippet}

{#snippet statusBadge(
	vm: AdminVm
)}
	{@const view = describeAdminVmStatusKey(adminVmStatusKey(vm))}
	<span
		class="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass[
			view.tone
		]}"
		title={vm.statusError ?? undefined}
	>
		{view.label}
	</span>
{/snippet}

{#snippet powerButton(
	vm: AdminVm,
	action: AdminVmPowerAction,
	label: string,
	Icon: IconComponent,
	iconClass: string,
	enabled: boolean
)}
	<Button
		variant="outline"
		size="sm"
		class="h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
		disabled={Boolean(actions.saving[vm.id]) || !enabled}
		onclick={() => actions.power(vm, action)}
	>
		{#if actions.saving[vm.id] === action}
			<Loader2 class="h-3 w-3 animate-spin" />
		{:else}
			<Icon class="h-3 w-3 {iconClass}" />
		{/if}
		{label}
	</Button>
{/snippet}

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if actions.error}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{actions.error}
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{@render statCard(Server, 'bg-sky-500/10', 'text-sky-400', activeVms.length, 'Total VMs')}
			{@render statCard(Play, 'bg-emerald-500/10', 'text-emerald-400', runningCount, 'Running')}
			{@render statCard(
				PowerOff,
				'bg-muted-foreground/10',
				'text-muted-foreground',
				stoppedCount,
				'Stopped'
			)}
			{@render statCard(AlertTriangle, 'bg-red-500/10', 'text-red-400', errorCount, 'Errors')}
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative max-w-xs flex-1">
				<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={search}
					placeholder="Search by name, project, owner, IP, VMID..."
					class="h-8 pl-8 text-xs"
				/>
			</div>
			<FilterMenu
				label="Owner"
				allLabel="All owners"
				options={ownerFilterOptions}
				bind:value={ownerFilter}
				contentClass="max-h-72 w-56 overflow-y-auto"
			/>
			<FilterMenu
				label="Type"
				allLabel="All types"
				options={typeFilterOptions}
				bind:value={typeFilter}
				contentClass="max-h-72 w-48 overflow-y-auto"
			/>
			<FilterMenu
				label="Status"
				allLabel="All statuses"
				options={statusFilterOptions}
				bind:value={statusFilter}
			/>
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<Switch id="admin-vms-show-deleted" bind:checked={showDeleted} />
				<label for="admin-vms-show-deleted">Show deleted</label>
			</div>
			<Button
				variant="outline"
				size="sm"
				class="ml-auto h-8 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => refresh()}
				disabled={refreshing}
			>
				{#if refreshing}
					<Loader2 class="h-3 w-3 animate-spin" />
				{:else}
					<RefreshCw class="h-3 w-3" />
				{/if}
				Refresh
			</Button>
		</div>

		{#if filteredVms.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
				<Server class="h-8 w-8 text-muted-foreground" />
				<p class="text-sm">No servers found</p>
			</div>
		{:else}
			<div class="overflow-x-auto rounded-md border border-border/60">
				<table class="w-full text-left text-xs">
					<thead>
						<tr
							class="border-b border-border/60 bg-background/40 text-[10px] tracking-wider text-muted-foreground uppercase"
						>
							<th class="px-4 py-2.5 font-medium">Server</th>
							<th class="px-4 py-2.5 font-medium">Project / Owner</th>
							<th class="px-4 py-2.5 font-medium">Type</th>
							<th class="px-4 py-2.5 font-medium">Status</th>
							<th class="px-4 py-2.5 font-medium">Uptime</th>
							<th class="px-4 py-2.5 font-medium">Created</th>
							<th class="px-4 py-2.5">
								<span class="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/50">
						{#each filteredVms as vm (vm.id)}
							<tr
								class="cursor-pointer transition-colors hover:bg-muted/20"
								onclick={(event) => openVmSheetFromRow(event, vm)}
							>
								<td class="px-4 py-3">
									<div class="flex flex-col gap-0.5">
										<span class="font-medium text-foreground">{vm.name}</span>
										<span class="font-mono text-[10px] text-muted-foreground">
											{vm.lastKnownIpv4 ?? vm.lastKnownIpv6 ?? vm.id}
										</span>
									</div>
								</td>
								<td class="px-4 py-3">
									<div class="flex flex-col gap-0.5">
										<span class="text-muted-foreground">{vm.projectName ?? '-'}</span>
										<span class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
											{vm.ownerEmail ?? 'no owner'}
											{#if vm.ownerBillingExempt || vm.projectBillingExempt}
												<span
													class="inline-flex items-center gap-0.5 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1 py-px font-medium text-violet-400"
												>
													<ShieldOff class="h-2.5 w-2.5" />No billing
												</span>
											{/if}
										</span>
									</div>
								</td>
								<td class="px-4 py-3">
									<div class="flex flex-col gap-0.5">
										<span class="text-muted-foreground">{vm.vmTypeName ?? '-'}</span>
										{#if vm.vmTypeCores}
											<span class="text-[10px] text-muted-foreground">
												{vm.vmTypeCores}c · {vm.vmTypeRamCapacity} MB · {vm.vmTypeStorageAmount} GB
											</span>
										{/if}
									</div>
								</td>
								<td class="px-4 py-3">{@render statusBadge(vm)}</td>
								<td class="px-4 py-3 text-muted-foreground">
									{(vm.liveStatus === 'running' ? formatUptime(vm.uptime) : null) ?? '-'}
								</td>
								<td class="px-4 py-3 text-muted-foreground">{formatDate(vm.createdAt)}</td>
								<td class="px-4 py-3 text-right" data-row-actions>
									<VmActionsMenu {vm} {actions} />
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<Sheet.Root open={selectedVm !== null} onOpenChange={(value) => !value && closeVmSheet()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if selectedVm}
			{@const vm = selectedVm}
			{@const status = adminVmServerStatus(vm)}
			<div class="flex flex-col gap-6">
				<div class="flex items-start justify-between gap-3 pr-8">
					<div class="flex min-w-0 flex-col gap-0.5">
						<span class="truncate text-base font-semibold text-foreground">{vm.name}</span>
						<span class="truncate font-mono text-xs text-muted-foreground">
							{vm.lastKnownIpv4 ?? vm.lastKnownIpv6 ?? vm.id}
						</span>
					</div>
					{@render statusBadge(vm)}
				</div>

				{#if vm.active}
					<div class="grid grid-cols-4 gap-2">
						{@render powerButton(
							vm,
							'start',
							'Start',
							Play,
							'text-emerald-400',
							canPowerOn(status)
						)}
						{@render powerButton(vm, 'stop', 'Stop', Power, '', canPowerOff(status))}
						{@render powerButton(
							vm,
							'reboot',
							'Reboot',
							RotateCw,
							'text-sky-400',
							canReboot(status)
						)}
						{@render powerButton(
							vm,
							'kill',
							'Kill',
							PowerOff,
							'text-amber-400',
							canPowerOff(status)
						)}
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
					{@render sectionTitle('Diagnostics')}
					{@render detailRow(Activity, 'Live status', vm.liveStatus ?? '-', 'text-foreground')}
					{@render detailRow(
						Clock,
						'Uptime',
						(vm.liveStatus === 'running' ? formatUptime(vm.uptime) : null) ?? '-'
					)}
					{#if vm.cpuUsage !== null}
						{@render detailRow(Cpu, 'CPU', formatPercent(vm.cpuUsage))}
					{/if}
					{#if vm.memoryUsageBytes !== null &&
						vm.memoryTotalBytes !== null &&
						vm.memoryTotalBytes > 0}
						{@render detailRow(
							HardDrive,
							'Memory',
							`${formatGibibytes(vm.memoryUsageBytes)} / ${formatGibibytes(vm.memoryTotalBytes)}`
						)}
					{/if}
					{@render detailRow(
						Server,
						'Node',
						vm.proxmoxNode ?? '-',
						'font-mono text-muted-foreground'
					)}
					{@render detailRow(
						Hash,
						'Proxmox VMID',
						String(vm.proxmoxId ?? '-'),
						'font-mono text-muted-foreground'
					)}
					{#if vm.lastKnownAt}
						{@render detailRow(Clock, 'Last seen', formatDateTime(vm.lastKnownAt))}
					{/if}
					{@render detailRow(
						Globe,
						'IPv4',
						vm.lastKnownIpv4 ?? '-',
						'font-mono text-muted-foreground'
					)}
					{@render detailRow(
						Globe,
						'IPv6',
						vm.lastKnownIpv6 ?? '-',
						'max-w-56 truncate font-mono text-muted-foreground'
					)}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					{@render sectionTitle('Type')}
					{@render detailRow(Cpu, 'Plan', vm.vmTypeName ?? '-', 'text-foreground')}
					{#if vm.vmTypeCores}
						{@render detailRow(
							Server,
							'Resources',
							`${vm.vmTypeCores}c · ${vm.vmTypeRamCapacity} MB · ${vm.vmTypeStorageAmount} GB`
						)}
					{/if}
					{#if vm.vmTypeRate}
						{@render detailRow(CreditCard, 'Rate', `$${vm.vmTypeRate}/hr`)}
					{/if}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					{@render sectionTitle('Project')}
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-2 text-xs text-muted-foreground">
							<Server class="h-3 w-3" />Project
						</span>
						{#if vm.projectId}
							<a
								class="text-xs text-foreground hover:underline"
								href={resolve(`admin/projects/${vm.projectId}`)}
								>{vm.projectName ?? vm.projectId}</a
							>
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
					{@render sectionTitle('Billing this month')}
					{#if billed.loading}
						<div class="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
							Computing billed usage...
						</div>
					{:else if billed.error}
						<div
							class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-xs text-red-400"
						>
							<AlertTriangle class="size-4 shrink-0" />{billed.error}
						</div>
					{:else if billed.usage}
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Billed</span>
								<span class="text-foreground"
									>{formatDecimal(billed.usage.billedHours)}
									unit-hours</span
								>
							</div>
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted-foreground">Reversed</span>
								<span class="text-foreground"
									>{formatDecimal(billed.usage.reversedHours)}
									unit-hours</span
								>
							</div>
							{#if billed.usage.estimatedAmount !== null}
								<div class="flex items-center justify-between text-xs">
									<span class="text-muted-foreground">Estimated charge (before caps)</span>
									<span class="text-foreground">{formatUsd(billed.usage.estimatedAmount)}</span>
								</div>
							{/if}
						</div>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="w-fit gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={() => actions.openReversal(vm)}
					>
						<CreditCard class="h-3 w-3 text-violet-400" />
						Reverse billing
					</Button>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					{@render sectionTitle('Record')}
					{@render detailRow(Hash, 'VM ID', vm.id, 'font-mono text-muted-foreground')}
					{@render detailRow(Calendar, 'Created', formatDateTime(vm.createdAt))}
					{#if vm.deletedAt}
						{@render detailRow(Trash2, 'Deleted', formatDateTime(vm.deletedAt))}
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
							onclick={() => actions.confirmDelete(vm)}
							disabled={Boolean(actions.saving[vm.id])}
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

<VmBillingReversalDialog bind:open={actions.reversalOpen} vm={actions.reversalVm} />
