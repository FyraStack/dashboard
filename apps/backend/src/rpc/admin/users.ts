import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type BeginDeleteUserInput,
	beginDeleteUser,
	type DeleteUserWithVerificationInput,
	deleteUserWithVerification,
	type GetUserResourcesInput,
	getUserResources,
	listAdminUsers,
	type SetUserAdminInput,
	type SetUserBillingExemptInput,
	type SetUserDisabledInput,
	type SetUserTwoFactorInput,
	setUserAdmin,
	setUserBillingExempt,
	setUserDisabled,
	setUserTwoFactor
} from '#lib/server/handlers/admin-users.js';
import { inScope } from '#lib/server/scope.js';

export class AdminUsers extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listAdminUsers());
	}

	setAdmin(input: SetUserAdminInput) {
		return inScope(this.#scope, () => setUserAdmin(input));
	}

	setDisabled(input: SetUserDisabledInput) {
		return inScope(this.#scope, () => setUserDisabled(input));
	}

	setBillingExempt(input: SetUserBillingExemptInput) {
		return inScope(this.#scope, () => setUserBillingExempt(input));
	}

	setTwoFactor(input: SetUserTwoFactorInput) {
		return inScope(this.#scope, () => setUserTwoFactor(input));
	}

	beginDelete(input: BeginDeleteUserInput) {
		return inScope(this.#scope, () => beginDeleteUser(input));
	}

	deleteWithVerification(input: DeleteUserWithVerificationInput) {
		return inScope(this.#scope, () => deleteUserWithVerification(input));
	}

	resources(input: GetUserResourcesInput) {
		return inScope(this.#scope, () => getUserResources(input));
	}
}
