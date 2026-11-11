import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import { loadTotpLoginPage } from '#lib/server/handlers/account-login.js';
import {
	type ConfirmTotpResetChoiceInput,
	confirmTotpResetChoice,
	sendTotpResetCode,
	type VerifyTotpResetCodeInput,
	verifyTotpResetCode
} from '#lib/server/handlers/two-factor.js';
import { inScope } from '#lib/server/scope.js';

export class TwoFactorReset extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	page() {
		return inScope(this.#scope, () => loadTotpLoginPage());
	}

	sendCode() {
		return inScope(this.#scope, () => sendTotpResetCode());
	}

	verifyCode(input: VerifyTotpResetCodeInput) {
		return inScope(this.#scope, () => verifyTotpResetCode(input));
	}

	confirmChoice(input: ConfirmTotpResetChoiceInput) {
		return inScope(this.#scope, () => confirmTotpResetChoice(input));
	}
}
