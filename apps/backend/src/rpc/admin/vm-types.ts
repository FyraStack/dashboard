import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type CreateVmTypeInput,
	createVmType,
	type DeleteVmTypeInput,
	deleteVmType,
	type ReorderVmTypesInput,
	reorderVmTypes,
	type UpdateVmTypeInput,
	updateVmType
} from '#lib/server/handlers/vm-types.js';
import { inScope } from '#lib/server/scope.js';

export class AdminVmTypes extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	create(input: CreateVmTypeInput) {
		return inScope(this.#scope, () => createVmType(input));
	}

	update(input: UpdateVmTypeInput) {
		return inScope(this.#scope, () => updateVmType(input));
	}

	reorder(input: ReorderVmTypesInput) {
		return inScope(this.#scope, () => reorderVmTypes(input));
	}

	delete(input: DeleteVmTypeInput) {
		return inScope(this.#scope, () => deleteVmType(input));
	}
}
