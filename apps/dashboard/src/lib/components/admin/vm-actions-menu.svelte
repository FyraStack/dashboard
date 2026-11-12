<script lang="ts">
	import { type AdminVmActions, adminVmServerStatus } from '#lib/admin-vm-actions.svelte.js';
	import { adminMenuItemClass } from '#lib/components/admin/menu-item-class.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import type { AdminVm } from '#lib/remote/admin-vms.remote.js';
	import { canPowerOff, canPowerOn, canReboot } from '#lib/vm-status.js';
	import Loader2 from '~icons/lucide/loader-2';
	import MoreHorizontal from '~icons/lucide/more-horizontal';
	import CreditCard from '~icons/nucleo/credit-card';
	import Play from '~icons/nucleo/play';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Trash2 from '~icons/nucleo/trash';

	let { vm, actions }: { vm: AdminVm; actions: AdminVmActions } = $props();

	const status = $derived(adminVmServerStatus(vm));
	const saving = $derived(actions.saving[vm.id]);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		disabled={Boolean(saving)}
		class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
		aria-label="Actions"
	>
		{#if saving}
			<Loader2 class="h-3.5 w-3.5 animate-spin" />
		{:else}
			<MoreHorizontal class="h-4 w-4" />
		{/if}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="w-44 border-border bg-background" align="end">
		{#if vm.active}
			<DropdownMenu.Item
				class={adminMenuItemClass}
				disabled={!canPowerOn(status)}
				onSelect={() => actions.power(vm, 'start')}
			>
				<Play class="size-4 text-emerald-400" />Start
			</DropdownMenu.Item>
			<DropdownMenu.Item
				class={adminMenuItemClass}
				disabled={!canPowerOff(status)}
				onSelect={() => actions.power(vm, 'stop')}
			>
				<Power class="size-4 text-muted-foreground" />Shut down
			</DropdownMenu.Item>
			<DropdownMenu.Item
				class={adminMenuItemClass}
				disabled={!canReboot(status)}
				onSelect={() => actions.power(vm, 'reboot')}
			>
				<RotateCw class="size-4 text-sky-400" />Reboot
			</DropdownMenu.Item>
			<DropdownMenu.Item
				class={adminMenuItemClass}
				disabled={!canPowerOff(status)}
				onSelect={() => actions.power(vm, 'kill')}
			>
				<PowerOff class="size-4 text-amber-400" />Force stop
			</DropdownMenu.Item>
			<DropdownMenu.Separator class="bg-muted" />
		{/if}
		<DropdownMenu.Item class={adminMenuItemClass} onSelect={() => actions.openReversal(vm)}>
			<CreditCard class="size-4 text-violet-400" />Reverse billing
		</DropdownMenu.Item>
		{#if vm.active}
			<DropdownMenu.Separator class="bg-muted" />
			<DropdownMenu.Item
				class="flex cursor-pointer items-center gap-2 text-xs text-red-400 data-[highlighted]:bg-red-500/10"
				onSelect={() => actions.confirmDelete(vm)}
			>
				<Trash2 class="size-4" />Delete
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
