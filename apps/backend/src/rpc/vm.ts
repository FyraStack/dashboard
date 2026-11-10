import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	getVmNetworking,
	type SetVmPtrRecordInput,
	setVmPtrRecord
} from '#lib/server/handlers/networking.js';
import {
	deleteVm,
	type GetVmMetricsHistoryInput,
	getVm,
	getVmMetricsHistory,
	powerVm,
	type RenameVmInput,
	type ResizeVmInput,
	renameVm,
	resizeVm
} from '#lib/server/handlers/vms.js';
import { inScope } from '#lib/server/scope.js';

export class Vm extends RpcTarget {
	readonly #scope: Scope;
	readonly #id: string;

	constructor(scope: Scope, id: string) {
		super();
		this.#scope = scope;
		this.#id = id;
	}

	get() {
		return inScope(this.#scope, () => getVm({ vmId: this.#id }));
	}

	metricsHistory(input?: Omit<GetVmMetricsHistoryInput, 'vmId'>) {
		return inScope(this.#scope, () => getVmMetricsHistory({ ...input, vmId: this.#id }));
	}

	rename(input: Omit<RenameVmInput, 'vmId'>) {
		return inScope(this.#scope, () => renameVm({ ...input, vmId: this.#id }));
	}

	delete() {
		return inScope(this.#scope, () => deleteVm({ vmId: this.#id }));
	}

	start() {
		return inScope(this.#scope, () => powerVm({ action: 'startVm', vmId: this.#id }));
	}

	stop() {
		return inScope(this.#scope, () => powerVm({ action: 'stopVm', vmId: this.#id }));
	}

	kill() {
		return inScope(this.#scope, () => powerVm({ action: 'killVm', vmId: this.#id }));
	}

	reboot() {
		return inScope(this.#scope, () => powerVm({ action: 'rebootVm', vmId: this.#id }));
	}

	resize(input: Omit<ResizeVmInput, 'vmId'>) {
		return inScope(this.#scope, () => resizeVm({ ...input, vmId: this.#id }));
	}

	networking() {
		return inScope(this.#scope, () => getVmNetworking({ vmId: this.#id }));
	}

	setPtrRecord(input: Omit<SetVmPtrRecordInput, 'vmId'>) {
		return inScope(this.#scope, () => setVmPtrRecord({ ...input, vmId: this.#id }));
	}
}
