import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	getVmBillingUsage,
	type ReverseVmBillingUsageInput,
	reverseVmBillingUsage,
	type VmBillingUsageInput
} from '#lib/server/handlers/admin-billing.js';

export class AdminBilling extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	vmUsage(input: VmBillingUsageInput) {
		return inScope(this.#scope, () => getVmBillingUsage(input));
	}

	reverseVmUsage(input: ReverseVmBillingUsageInput) {
		return inScope(this.#scope, () => reverseVmBillingUsage(input));
	}
}
