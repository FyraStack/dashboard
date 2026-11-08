import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type CreateIpamPrefixInput,
	createIpamPrefix,
	type DeleteIpamPrefixInput,
	deleteIpamPrefix,
	getIpamPtrDefaultFormats,
	listIpamPrefixes,
	type SetIpamPrefixDisabledInput,
	setIpamPrefixDisabled,
	type UpdateIpamPrefixInput,
	type UpdateIpamPtrDefaultFormatsInput,
	updateIpamPrefix,
	updateIpamPtrDefaultFormats
} from '#lib/server/handlers/ipam.js';

export class AdminIpam extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	listPrefixes() {
		return inScope(this.#scope, () => listIpamPrefixes());
	}

	createPrefix(input: CreateIpamPrefixInput) {
		return inScope(this.#scope, () => createIpamPrefix(input));
	}

	updatePrefix(input: UpdateIpamPrefixInput) {
		return inScope(this.#scope, () => updateIpamPrefix(input));
	}

	setPrefixDisabled(input: SetIpamPrefixDisabledInput) {
		return inScope(this.#scope, () => setIpamPrefixDisabled(input));
	}

	deletePrefix(input: DeleteIpamPrefixInput) {
		return inScope(this.#scope, () => deleteIpamPrefix(input));
	}

	ptrDefaultFormats() {
		return inScope(this.#scope, () => getIpamPtrDefaultFormats());
	}

	updatePtrDefaultFormats(input: UpdateIpamPtrDefaultFormatsInput) {
		return inScope(this.#scope, () => updateIpamPtrDefaultFormats(input));
	}
}
