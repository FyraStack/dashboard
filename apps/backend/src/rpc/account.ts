import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import { loadAppLayoutAccount } from '#lib/server/handlers/account-layout.js';
import {
	type AnnouncementImageLookupInput,
	getAnnouncementImage,
	type MarkAnnouncementsReadInput,
	markAnnouncementsRead,
	type SetAnnouncementsEnabledInput,
	setAnnouncementsEnabled
} from '#lib/server/handlers/announcements.js';
import {
	type CreateApiTokenInput,
	createApiToken,
	listApiTokens,
	type RevokeApiTokenInput,
	revokeApiToken
} from '#lib/server/handlers/api-tokens.js';
import {
	getPendingEmailChange,
	type RequestEmailChangeInput,
	requestEmailChange
} from '#lib/server/handlers/email-change.js';
import {
	type ConfirmPasswordChangeWithEmailInput,
	type ConfirmPasswordChangeWithPasskeyInput,
	type ConfirmPasswordChangeWithTotpInput,
	confirmPasswordChangeWithEmail,
	confirmPasswordChangeWithPasskey,
	confirmPasswordChangeWithTotp,
	hasPassword,
	sendPasswordChangeCode
} from '#lib/server/handlers/password-change.js';
import {
	type CreateSshKeyInput,
	createSshKey,
	type DeleteSshKeyInput,
	deleteSshKey,
	listSshKeys
} from '#lib/server/handlers/ssh-keys.js';
import {
	type DisableTwoFactorWithVerificationInput,
	disableTwoFactorWithVerification
} from '#lib/server/handlers/two-factor.js';

export class Account extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	listApiTokens() {
		return inScope(this.#scope, () => listApiTokens());
	}

	createApiToken(input: CreateApiTokenInput) {
		return inScope(this.#scope, () => createApiToken(input));
	}

	revokeApiToken(input: RevokeApiTokenInput) {
		return inScope(this.#scope, () => revokeApiToken(input));
	}

	listSshKeys() {
		return inScope(this.#scope, () => listSshKeys());
	}

	createSshKey(input: CreateSshKeyInput) {
		return inScope(this.#scope, () => createSshKey(input));
	}

	deleteSshKey(input: DeleteSshKeyInput) {
		return inScope(this.#scope, () => deleteSshKey(input));
	}

	pendingEmailChange() {
		return inScope(this.#scope, () => getPendingEmailChange());
	}

	requestEmailChange(input: RequestEmailChangeInput) {
		return inScope(this.#scope, () => requestEmailChange(input));
	}

	disableTwoFactor(input: DisableTwoFactorWithVerificationInput) {
		return inScope(this.#scope, () => disableTwoFactorWithVerification(input));
	}

	sendPasswordChangeCode() {
		return inScope(this.#scope, () => sendPasswordChangeCode());
	}

	hasPassword() {
		return inScope(this.#scope, () => hasPassword());
	}

	changePasswordWithEmail(input: ConfirmPasswordChangeWithEmailInput) {
		return inScope(this.#scope, () => confirmPasswordChangeWithEmail(input));
	}

	changePasswordWithTotp(input: ConfirmPasswordChangeWithTotpInput) {
		return inScope(this.#scope, () => confirmPasswordChangeWithTotp(input));
	}

	changePasswordWithPasskey(input: ConfirmPasswordChangeWithPasskeyInput) {
		return inScope(this.#scope, () => confirmPasswordChangeWithPasskey(input));
	}

	markAnnouncementsRead(input: MarkAnnouncementsReadInput) {
		return inScope(this.#scope, () => markAnnouncementsRead(input));
	}

	setAnnouncementsEnabled(input: SetAnnouncementsEnabledInput) {
		return inScope(this.#scope, () => setAnnouncementsEnabled(input));
	}

	announcementImage(input: AnnouncementImageLookupInput) {
		return inScope(this.#scope, () => getAnnouncementImage(input));
	}

	appLayout() {
		return inScope(this.#scope, () => loadAppLayoutAccount());
	}
}
