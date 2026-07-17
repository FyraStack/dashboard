<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import VmBillingReversalDialog from '$lib/components/admin/vm-billing-reversal-dialog.svelte';
	import VmDetailSheet from '$lib/components/admin/vm-detail-sheet.svelte';
	import type { AdminVm } from '$lib/remote/admin-vms.remote';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import Loader2 from '~icons/lucide/loader-2';
	import MoreHorizontal from '~icons/lucide/more-horizontal';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import CreditCard from '~icons/nucleo/credit-card';
	import Play from '~icons/nucleo/play';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RefreshCw from '~icons/nucleo/refresh-cw';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import ShieldOff from '~icons/nucleo/shield-off';
	import Trash2 from '~icons/nucleo/trash';

	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState();
	$effect(() => {
		admin.sync(data);
	});

	let search = $state('');
	let ownerFilter = $state('all');
	let typeFilter = $state('all');
	let statusFilter = $state('all');
	let showDeleted = $state(false);
	let refreshing = $state(false);
	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<AdminVm | null>(null);
	let deleteConfirmName = $state('');

	const activeVms = $derived(admin.adminVms.filter((vm) => vm.active));
	const runningCount = $derived(activeVms.filter((vm) => vm.liveStatus === 'running').length);
	const stoppedCount = $derived(
		activeVms.filter((vm) => vm.liveStatus !== 'running' && vm.status !== 'error').length
	);
	const errorCount = $derived(activeVms.filter((vm) => vm.status === 'error').length);

	const ownerOptions = $derived(
		[
			...new Map(
				admin.adminVms
					.filter((vm) => vm.ownerEmail)
					.map((vm) => [vm.ownerEmail!, vm.ownerName ?? vm.ownerEmail!])
			).entries()
		]
			.map(([email, name]) => ({ email, name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const typeOptions = $derived(
		[...new Set(admin.adminVms.map((vm) => vm.vmTypeName).filter(Boolean) as string[])].sort()
	);
	const statusOptions = [
		'running',
		'stopped',
		'paused',
		'provisioning',
		'deleting',
		'error'
	] as const;
	const ownerFilterLabel = $derived(
		ownerFilter === 'all'
			? 'All'
			: (ownerOptions.find((owner) => owner.email === ownerFilter)?.name ?? ownerFilter)
	);

	const filteredVms = $derived(
		admin.adminVms.filter((vm) => {
			if (!showDeleted && !vm.active) return false;
			if (ownerFilter !== 'all' && vm.ownerEmail !== ownerFilter) return false;
			if (typeFilter !== 'all' && vm.vmTypeName !== typeFilter) return false;
			if (statusFilter !== 'all' && statusInfo(vm).label !== statusFilter) return false;
			const term = search.trim().toLowerCase();
			if (!term) return true;
			return [vm.name, vm.projectName, vm.ownerName, vm.ownerEmail, vm.lastKnownIpv4, vm.id]
				.filter(Boolean)
				.some((value) => value!.toLowerCase().includes(term));
		})
	);

	function statusInfo(vm: AdminVm) {
		if (!vm.active)
			return { label: 'deleted', class: 'border-ring/20 bg-muted/30 text-muted-foreground' };
		if (vm.status === 'deleting')
			return { label: 'deleting', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (vm.status === 'error')
			return { label: 'error', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (vm.status === 'provisioning')
			return { label: 'provisioning', class: 'border-sky-500/20 bg-sky-500/10 text-sky-400' };
		if (vm.liveStatus === 'running')
			return {
				label: 'running',
				class: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
			};
		if (vm.liveStatus === 'paused')
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

	function formatDate(timestamp: number) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(timestamp));
	}

	async function refresh() {
		refreshing = true;
		try {
			await admin.refreshAdminVms();
		} finally {
			refreshing = false;
		}
	}

	let reversalOpen = $state(false);
	let reversalVm = $state<{ id: string; name: string; projectName: string | null } | null>(null);

	function openReversal(vm: AdminVm) {
		reversalVm = { id: vm.id, name: vm.name, projectName: vm.projectName };
		reversalOpen = true;
	}

	const vmsBase = resolve('/admin/vms');
	const selectedVm = $derived(
		page.params.id ? (admin.adminVms.find((vm) => vm.id === page.params.id) ?? null) : null
	);

	function openVmSheet(vm: AdminVm) {
		void goto(resolve(`/admin/vms/${vm.id}`), { noScroll: true, keepFocus: true });
	}

	function closeVmSheet() {
		void goto(vmsBase, { noScroll: true, keepFocus: true });
	}

	function openDeleteDialog(vm: AdminVm) {
		deleteTarget = vm;
		deleteConfirmName = '';
		deleteDialogOpen = true;
	}

	function closeDeleteDialog() {
		deleteDialogOpen = false;
		deleteTarget = null;
		deleteConfirmName = '';
	}

	const deleteDisabled = $derived(
		!deleteTarget ||
			deleteConfirmName !== deleteTarget.name ||
			Boolean(deleteTarget && admin.adminVmSaving[deleteTarget.id])
	);

	async function confirmDelete() {
		if (!deleteTarget || deleteDisabled) return;
		try {
			await admin.adminVmDelete(deleteTarget.id);
			closeDeleteDialog();
		} catch {
			return;
		}
	}
</script>

<svelte:head>
	<title>VMs</title>
</svelte:head>

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if admin.adminVmError}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{admin.adminVmError}
			</div>
		{/if}

		<!-- Stat row -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10">
					<Server class="h-4 w-4 text-sky-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{activeVms.length}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Total VMs</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
					<Play class="h-4 w-4 text-emerald-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{runningCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Running</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted-foreground/10"
				>
					<PowerOff class="h-4 w-4 text-muted-foreground" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{stoppedCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Stopped</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/10">
					<AlertTriangle class="h-4 w-4 text-red-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{errorCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Errors</span>
				</div>
			</div>
		</div>

		<!-- Filters -->
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative max-w-xs flex-1">
				<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={search}
					placeholder="Search by name, project, owner, IP..."
					class="h-8 pl-8 text-xs"
				/>
			</div>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1.5 border-border/50 text-xs {ownerFilter === 'all'
							? 'text-muted-foreground'
							: 'text-foreground'} hover:bg-muted hover:text-foreground"
					>
						Owner: {ownerFilterLabel}
						<ChevronDown class="h-3 w-3 text-muted-foreground" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="max-h-72 w-56 overflow-y-auto border-border bg-background">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
						onSelect={() => (ownerFilter = 'all')}
					>
						All owners
						{#if ownerFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-muted" />
					{#each ownerOptions as owner (owner.email)}
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (ownerFilter = owner.email)}
						>
							<span class="flex min-w-0 flex-col">
								<span class="truncate">{owner.name}</span>
								<span class="truncate text-[10px] text-muted-foreground">{owner.email}</span>
							</span>
							{#if ownerFilter === owner.email}
								<Check class="ml-auto h-3 w-3 shrink-0 text-emerald-400" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1.5 border-border/50 text-xs {typeFilter === 'all'
							? 'text-muted-foreground'
							: 'text-foreground'} hover:bg-muted hover:text-foreground"
					>
						Type: {typeFilter === 'all' ? 'All' : typeFilter}
						<ChevronDown class="h-3 w-3 text-muted-foreground" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="max-h-72 w-48 overflow-y-auto border-border bg-background">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
						onSelect={() => (typeFilter = 'all')}
					>
						All types
						{#if typeFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-muted" />
					{#each typeOptions as vmTypeName (vmTypeName)}
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (typeFilter = vmTypeName)}
						>
							{vmTypeName}
							{#if typeFilter === vmTypeName}
								<Check class="ml-auto h-3 w-3 text-emerald-400" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1.5 border-border/50 text-xs {statusFilter === 'all'
							? 'text-muted-foreground'
							: 'text-foreground'} hover:bg-muted hover:text-foreground"
					>
						Status: {statusFilter === 'all' ? 'All' : statusFilter}
						<ChevronDown class="h-3 w-3 text-muted-foreground" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-44 border-border bg-background">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
						onSelect={() => (statusFilter = 'all')}
					>
						All statuses
						{#if statusFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-muted" />
					{#each statusOptions as status (status)}
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground capitalize data-[highlighted]:bg-muted"
							onSelect={() => (statusFilter = status)}
						>
							{status}
							{#if statusFilter === status}
								<Check class="ml-auto h-3 w-3 text-emerald-400" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<label class="flex items-center gap-2 text-xs text-muted-foreground">
				<Switch bind:checked={showDeleted} />
				Show deleted
			</label>
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
							<th class="px-4 py-2.5"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/50">
						{#each filteredVms as vm (vm.id)}
							{@const info = statusInfo(vm)}
							{@const saving = admin.adminVmSaving[vm.id]}
							<tr
								class="cursor-pointer transition-colors hover:bg-muted/20"
								onclick={() => openVmSheet(vm)}
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
								<td class="px-4 py-3">
									<span
										class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {info.class}"
										title={vm.statusError ?? undefined}
									>
										{info.label}
									</span>
								</td>
								<td class="px-4 py-3 text-muted-foreground">
									{vm.liveStatus === 'running' ? formatUptime(vm.uptime) : '-'}
								</td>
								<td class="px-4 py-3 text-muted-foreground">{formatDate(vm.createdAt)}</td>
								<td class="px-4 py-3 text-right" onclick={(event) => event.stopPropagation()}>
									<DropdownMenu.Root>
										<DropdownMenu.Trigger disabled={Boolean(saving)}>
											<Button
												variant="ghost"
												size="sm"
												class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
											>
												{#if saving}
													<Loader2 class="h-3.5 w-3.5 animate-spin" />
												{:else}
													<MoreHorizontal class="h-4 w-4" />
												{/if}
											</Button>
										</DropdownMenu.Trigger>
										<DropdownMenu.Content class="w-44 border-border bg-background" align="end">
											{#if vm.active}
												<DropdownMenu.Item
													class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
													disabled={vm.liveStatus === 'running'}
													onSelect={() => admin.adminVmPower(vm.id, 'start')}
												>
													<Play class="size-4 text-emerald-400" />Start
												</DropdownMenu.Item>
												<DropdownMenu.Item
													class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
													disabled={vm.liveStatus !== 'running'}
													onSelect={() => admin.adminVmPower(vm.id, 'stop')}
												>
													<Power class="size-4 text-muted-foreground" />Shut down
												</DropdownMenu.Item>
												<DropdownMenu.Item
													class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
													disabled={vm.liveStatus !== 'running'}
													onSelect={() => admin.adminVmPower(vm.id, 'reboot')}
												>
													<RotateCw class="size-4 text-sky-400" />Reboot
												</DropdownMenu.Item>
												<DropdownMenu.Item
													class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
													disabled={vm.liveStatus !== 'running'}
													onSelect={() => admin.adminVmPower(vm.id, 'kill')}
												>
													<PowerOff class="size-4 text-amber-400" />Force stop
												</DropdownMenu.Item>
												<DropdownMenu.Separator class="bg-muted" />
											{/if}
											<DropdownMenu.Item
												class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
												onSelect={() => openReversal(vm)}
											>
												<CreditCard class="size-4 text-violet-400" />Reverse billing
											</DropdownMenu.Item>
											{#if vm.active}
												<DropdownMenu.Separator class="bg-muted" />
												<DropdownMenu.Item
													class="flex cursor-pointer items-center gap-2 text-xs text-red-400 data-[highlighted]:bg-red-500/10"
													onSelect={() => openDeleteDialog(vm)}
												>
													<Trash2 class="size-4" />Delete
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<!-- Delete confirmation -->
<Dialog.Root
	bind:open={deleteDialogOpen}
	onOpenChange={(value) => {
		if (!value) closeDeleteDialog();
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Delete {deleteTarget?.name}?</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				This deprovisions the server in Proxmox, releases its networking, and records final usage.
				It belongs to {deleteTarget?.projectName ?? 'an unknown project'}
				({deleteTarget?.ownerEmail ?? 'no owner'}).
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-4"
			onsubmit={(event) => {
				event.preventDefault();
				void confirmDelete();
			}}
		>
			<div
				class="flex flex-col gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-200/80"
			>
				<p class="font-medium text-red-200">This action cannot be undone.</p>
				<p>Type <span class="font-mono text-red-200">{deleteTarget?.name}</span> to confirm.</p>
			</div>

			<Input bind:value={deleteConfirmName} placeholder={deleteTarget?.name} autocomplete="off" />

			<Dialog.Footer class="flex items-center gap-2 pt-2">
				<Button
					variant="outline"
					type="button"
					size="sm"
					class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => closeDeleteDialog()}
				>
					Cancel
				</Button>
				<Button
					variant="destructive"
					type="submit"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={deleteDisabled}
				>
					{#if deleteTarget && admin.adminVmSaving[deleteTarget.id] === 'delete'}
						<Loader2 class="h-3 w-3 animate-spin" />
						Deleting...
					{:else}
						<Trash2 class="h-3 w-3" />
						Delete server
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<VmDetailSheet
	open={selectedVm !== null}
	vm={selectedVm}
	{admin}
	onClose={closeVmSheet}
	onReverse={openReversal}
	onDelete={openDeleteDialog}
/>

<VmBillingReversalDialog bind:open={reversalOpen} vm={reversalVm} />
