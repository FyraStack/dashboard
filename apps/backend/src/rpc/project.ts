import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	getProjectBilling,
	openBillingPortal,
	type PurchaseCreditsInput,
	purchaseCredits,
	type SetupProjectBillingPaymentInput,
	setupProjectBillingPayment
} from '#lib/server/handlers/billing.js';
import {
	type CompleteCreateServerBillingSetupInput,
	completeCreateServerBillingSetup,
	loadCreateServerPage
} from '#lib/server/handlers/compute-create-server.js';
import {
	type LoadProjectBillingPageInput,
	loadProjectBillingPage
} from '#lib/server/handlers/project-billing-page.js';
import {
	type AddMemberInput,
	addMember,
	deleteProject,
	getProject,
	type RemoveMemberInput,
	removeMember,
	type UpdateMemberRoleInput,
	type UpdateProjectInput,
	updateMemberRole,
	updateProject
} from '#lib/server/handlers/projects.js';
import { type CreateVmInput, createVm, listVmStatuses, listVms } from '#lib/server/handlers/vms.js';
import { type CreateVolumeInput, createVolume, listVolumes } from '#lib/server/handlers/volumes.js';

export class Project extends RpcTarget {
	readonly #scope: Scope;
	readonly #id: string;

	constructor(scope: Scope, id: string) {
		super();
		this.#scope = scope;
		this.#id = id;
	}

	get() {
		return inScope(this.#scope, () => getProject({ projectId: this.#id }));
	}

	update(input: Omit<UpdateProjectInput, 'projectId'>) {
		return inScope(this.#scope, () => updateProject({ ...input, projectId: this.#id }));
	}

	delete() {
		return inScope(this.#scope, () => deleteProject({ projectId: this.#id }));
	}

	addMember(input: Omit<AddMemberInput, 'projectId'>) {
		return inScope(this.#scope, () => addMember({ ...input, projectId: this.#id }));
	}

	updateMemberRole(input: Omit<UpdateMemberRoleInput, 'projectId'>) {
		return inScope(this.#scope, () => updateMemberRole({ ...input, projectId: this.#id }));
	}

	removeMember(input: Omit<RemoveMemberInput, 'projectId'>) {
		return inScope(this.#scope, () => removeMember({ ...input, projectId: this.#id }));
	}

	billing() {
		return inScope(this.#scope, () => getProjectBilling({ projectId: this.#id }));
	}

	openBillingPortal() {
		return inScope(this.#scope, () => openBillingPortal({ projectId: this.#id }));
	}

	purchaseCredits(input: Omit<PurchaseCreditsInput, 'projectId'>) {
		return inScope(this.#scope, () => purchaseCredits({ ...input, projectId: this.#id }));
	}

	setupBillingPayment(input: Omit<SetupProjectBillingPaymentInput, 'projectId'>) {
		return inScope(this.#scope, () =>
			setupProjectBillingPayment({ ...input, projectId: this.#id })
		);
	}

	billingPage(input: Omit<LoadProjectBillingPageInput, 'projectId'>) {
		return inScope(this.#scope, () => loadProjectBillingPage({ ...input, projectId: this.#id }));
	}

	listVms() {
		return inScope(this.#scope, () => listVms({ projectId: this.#id }));
	}

	listVmStatuses() {
		return inScope(this.#scope, () => listVmStatuses({ projectId: this.#id }));
	}

	createVm(input: Omit<CreateVmInput, 'projectId'>) {
		return inScope(this.#scope, () => createVm({ ...input, projectId: this.#id }));
	}

	listVolumes() {
		return inScope(this.#scope, () => listVolumes({ projectId: this.#id }));
	}

	createVolume(input: Omit<CreateVolumeInput, 'projectId'>) {
		return inScope(this.#scope, () => createVolume({ ...input, projectId: this.#id }));
	}

	createServerPage() {
		return inScope(this.#scope, () => loadCreateServerPage({ projectId: this.#id }));
	}

	completeCreateServerBillingSetup(
		input: Omit<CompleteCreateServerBillingSetupInput, 'projectId'>
	) {
		return inScope(this.#scope, () =>
			completeCreateServerBillingSetup({ ...input, projectId: this.#id })
		);
	}
}
