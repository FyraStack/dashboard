import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import { loadAdminLayout } from '#lib/server/handlers/admin-layout.js';
import {
	type UpdateFeatureFlagInput,
	updateFeatureFlag
} from '#lib/server/handlers/feature-flags.js';
import { AdminAnnouncements } from './admin/announcements.ts';
import { AdminBilling } from './admin/billing.ts';
import { AdminEmails } from './admin/emails.ts';
import { AdminImages } from './admin/images.ts';
import { AdminIpam } from './admin/ipam.ts';
import { AdminProjects } from './admin/projects.ts';
import { AdminUsers } from './admin/users.ts';
import { AdminVmTypes } from './admin/vm-types.ts';
import { AdminVms } from './admin/vms.ts';

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

	announcements() {
		return new AdminAnnouncements(this.#scope);
	}
}
