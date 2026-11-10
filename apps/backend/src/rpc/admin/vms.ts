import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type AdminVmInput,
	adminDeleteVm,
	adminPowerVm,
	listAllAdminVms
} from '#lib/server/handlers/admin-vms.js';
import { inScope } from '#lib/server/scope.js';

export class AdminVms extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listAllAdminVms());
	}

	start(input: AdminVmInput) {
		return inScope(this.#scope, () => adminPowerVm({ ...input, action: 'startVm' }));
	}

	stop(input: AdminVmInput) {
		return inScope(this.#scope, () => adminPowerVm({ ...input, action: 'stopVm' }));
	}

	kill(input: AdminVmInput) {
		return inScope(this.#scope, () => adminPowerVm({ ...input, action: 'killVm' }));
	}

	reboot(input: AdminVmInput) {
		return inScope(this.#scope, () => adminPowerVm({ ...input, action: 'rebootVm' }));
	}

	delete(input: AdminVmInput) {
		return inScope(this.#scope, () => adminDeleteVm(input));
	}
}
