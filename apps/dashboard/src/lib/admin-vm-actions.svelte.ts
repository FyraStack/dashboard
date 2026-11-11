import type { ServerStatus } from 'stack-shared/vm-status';
import { toServerStatus } from 'stack-shared/vm-status';
import { confirmDestructive } from '#lib/confirm.svelte.js';
import { dependencies } from '#lib/dependencies.js';
import {
	type AdminVm,
	adminDeleteVm,
	adminKillVm,
	adminRebootVm,
	adminStartVm,
	adminStopVm
} from '#lib/remote/admin-vms.remote.js';
import { getErrorMessage } from '#lib/utils.js';
import { describeServerStatus, type StatusView, serverStatuses } from '#lib/vm-status.js';
import { invalidate } from '$app/navigation';

export type AdminVmPowerAction = 'start' | 'stop' | 'kill' | 'reboot';

export type AdminVmStatusKey = ServerStatus | 'deleted';

export const adminVmStatusKeys: readonly AdminVmStatusKey[] = [...serverStatuses, 'deleted'];

const deletedView: StatusView = { label: 'Deleted', tone: 'muted', pending: false };

export function describeAdminVmStatusKey(key: AdminVmStatusKey): StatusView {
	return key === 'deleted' ? deletedView : describeServerStatus(key);
}

export function adminVmServerStatus(vm: AdminVm): ServerStatus {
	return toServerStatus(vm.status, vm.liveStatus);
}

export function adminVmStatusKey(vm: AdminVm): AdminVmStatusKey {
	return vm.active ? adminVmServerStatus(vm) : 'deleted';
}

const powerCommands = {
	start: adminStartVm,
	stop: adminStopVm,
	kill: adminKillVm,
	reboot: adminRebootVm
} as const;

interface ReversalTarget {
	id: string;
	name: string;
	projectName: string | null;
}

export class AdminVmActions {
	error = $state('');
	saving = $state<Record<string, AdminVmPowerAction | 'delete'>>({});
	reversalOpen = $state(false);
	reversalVm = $state<ReversalTarget | null>(null);

	async refresh() {
		try {
			await invalidate(dependencies.admin.vms);
		} catch (err) {
			this.error = getErrorMessage(err, 'Failed to refresh servers');
		}
	}

	async power(vm: AdminVm, action: AdminVmPowerAction) {
		await this.#run(vm, action, `Failed to ${action} server`, () =>
			powerCommands[action]({ vmId: vm.id })
		);
	}

	async confirmDelete(vm: AdminVm) {
		const confirmed = await confirmDestructive({
			title: `Delete ${vm.name}?`,
			description: `This deprovisions the server in Proxmox, releases its networking, and records final usage. It belongs to ${vm.projectName ?? 'an unknown project'} (${vm.ownerEmail ?? 'no owner'}).`,
			confirmWord: vm.name,
			confirmLabel: 'Delete server'
		});
		if (confirmed) {
			await this.#run(vm, 'delete', 'Failed to delete server', () =>
				adminDeleteVm({ vmId: vm.id })
			);
		}
	}

	openReversal(vm: AdminVm) {
		this.reversalVm = { id: vm.id, name: vm.name, projectName: vm.projectName };
		this.reversalOpen = true;
	}

	async #run(
		vm: AdminVm,
		action: AdminVmPowerAction | 'delete',
		failureMessage: string,
		command: () => Promise<unknown>
	) {
		this.error = '';
		this.saving[vm.id] = action;
		try {
			await command();
			await Promise.all([
				invalidate(dependencies.admin.vms),
				invalidate(dependencies.admin.projects)
			]);
		} catch (err) {
			this.error = getErrorMessage(err, failureMessage);
		} finally {
			delete this.saving[vm.id];
		}
	}
}
