import { RpcTarget } from 'cloudflare:workers';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { context, type Scope } from '#lib/server/context.js';
import { listImages } from '#lib/server/handlers/images.js';
import { loadAcceptInvitationPage } from '#lib/server/handlers/project-invitations.js';
import { listVmTypes } from '#lib/server/handlers/vm-types.js';
import { inScope, releaseScope } from '#lib/server/scope.js';
import { Account } from './account.ts';
import { Admin } from './admin.ts';
import { Project } from './project.ts';
import { Projects } from './projects.ts';
import { TwoFactorReset } from './two-factor-reset.ts';
import { Vm } from './vm.ts';
import { Volume } from './volume.ts';

export class Caller extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	release() {
		releaseScope(this.#scope);
	}

	[Symbol.dispose]() {
		this.release();
	}

	session() {
		return inScope(this.#scope, () => {
			const { locals, setCookie } = context();
			const { session, user } = locals;
			return { current: session && user ? { session, user } : null, setCookie };
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
		return inScope(this.#scope, async () => {
			await requireAdminUser();
			return new Admin(this.#scope);
		});
	}
}
