import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type AdminVmPowerInput,
	adminDeleteVm,
	adminKillVm,
	adminRebootVm,
	adminStartVm,
	adminStopVm,
	listAllAdminVms
} from '#lib/server/handlers/admin-vms.js';

export class AdminVms extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listAllAdminVms());
	}

	start(input: AdminVmPowerInput) {
		return inScope(this.#scope, () => adminStartVm(input));
	}

	stop(input: AdminVmPowerInput) {
		return inScope(this.#scope, () => adminStopVm(input));
	}

	kill(input: AdminVmPowerInput) {
		return inScope(this.#scope, () => adminKillVm(input));
	}

	reboot(input: AdminVmPowerInput) {
		return inScope(this.#scope, () => adminRebootVm(input));
	}

	delete(input: AdminVmPowerInput) {
		return inScope(this.#scope, () => adminDeleteVm(input));
	}
}
