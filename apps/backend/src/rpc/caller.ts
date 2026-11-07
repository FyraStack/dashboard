import { RpcTarget } from 'cloudflare:workers';
import { context, inScope, type Scope } from '#lib/server/context.js';
import { listImages } from '#lib/server/handlers/images.js';
import { loadAcceptInvitationPage } from '#lib/server/handlers/project-invitations.js';
import { listVmTypes } from '#lib/server/handlers/vm-types.js';
import { Account } from './account.js';
import { Admin } from './admin.js';
import { Project } from './project.js';
import { Projects } from './projects.js';
import { TwoFactorReset } from './two-factor-reset.js';
import { Vm } from './vm.js';
import { Volume } from './volume.js';

export class Caller extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	session() {
		return inScope(this.#scope, () => {
			const { session, user } = context().locals;
			return session && user ? { session, user } : null;
		});
	}

	account() {
		return new Account(this.#scope);
	}

	twoFactorReset() {
		return new TwoFactorReset(this.#scope);
	}

	projects() {
		return new Projects(this.#scope);
	}

	project(id: string) {
		return new Project(this.#scope, id);
	}

	vm(id: string) {
		return new Vm(this.#scope, id);
	}

	volume(id: string) {
		return new Volume(this.#scope, id);
	}

	listImages() {
		return inScope(this.#scope, () => listImages());
	}

	listVmTypes() {
		return inScope(this.#scope, () => listVmTypes());
	}

	invitationPage(invitationId: string) {
		return inScope(this.#scope, () => loadAcceptInvitationPage({ invitationId }));
	}

	admin() {
		return new Admin(this.#scope);
	}
}
