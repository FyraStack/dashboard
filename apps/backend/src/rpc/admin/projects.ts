import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type BeginDeleteProjectInput,
	beginDeleteProject,
	type CreateAdminProjectInput,
	type CreateAdminVmInput,
	createAdminProject,
	createAdminVm,
	type DeleteProjectWithVerificationInput,
	deleteProjectWithVerification,
	listAdminProjects,
	type SetProjectBillingExemptInput,
	type SetProjectDisabledInput,
	setProjectBillingExempt,
	setProjectDisabled
} from '#lib/server/handlers/admin-projects.js';
import {
	type GetOrganizationResourcesInput,
	getOrganizationResources
} from '#lib/server/handlers/admin-users.js';

export class AdminProjects extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listAdminProjects());
	}

	setBillingExempt(input: SetProjectBillingExemptInput) {
		return inScope(this.#scope, () => setProjectBillingExempt(input));
	}

	create(input: CreateAdminProjectInput) {
		return inScope(this.#scope, () => createAdminProject(input));
	}

	createVm(input: CreateAdminVmInput) {
		return inScope(this.#scope, () => createAdminVm(input));
	}

	setDisabled(input: SetProjectDisabledInput) {
		return inScope(this.#scope, () => setProjectDisabled(input));
	}

	beginDelete(input: BeginDeleteProjectInput) {
		return inScope(this.#scope, () => beginDeleteProject(input));
	}

	deleteWithVerification(input: DeleteProjectWithVerificationInput) {
		return inScope(this.#scope, () => deleteProjectWithVerification(input));
	}

	resources(input: GetOrganizationResourcesInput) {
		return inScope(this.#scope, () => getOrganizationResources(input));
	}
}
