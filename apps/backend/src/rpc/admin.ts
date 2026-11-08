import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import { loadAdminLayout } from '#lib/server/handlers/admin-layout.js';
import {
	type UpdateFeatureFlagInput,
	updateFeatureFlag
} from '#lib/server/handlers/feature-flags.js';
import { AdminBilling } from './admin/billing.js';
import { AdminEmails } from './admin/emails.js';
import { AdminImages } from './admin/images.js';
import { AdminIpam } from './admin/ipam.js';
import { AdminProjects } from './admin/projects.js';
import { AdminUsers } from './admin/users.js';
import { AdminVmTypes } from './admin/vm-types.js';
import { AdminVms } from './admin/vms.js';

export class Admin extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	layout() {
		return inScope(this.#scope, () => loadAdminLayout());
	}

	updateFeatureFlag(input: UpdateFeatureFlagInput) {
		return inScope(this.#scope, () => updateFeatureFlag(input));
	}

	users() {
		return new AdminUsers(this.#scope);
	}

	projects() {
		return new AdminProjects(this.#scope);
	}

	vms() {
		return new AdminVms(this.#scope);
	}

	billing() {
		return new AdminBilling(this.#scope);
	}

	vmTypes() {
		return new AdminVmTypes(this.#scope);
	}

	ipam() {
		return new AdminIpam(this.#scope);
	}

	images() {
		return new AdminImages(this.#scope);
	}

	emails() {
		return new AdminEmails(this.#scope);
	}
}
