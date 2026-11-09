import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type AnnouncementInput,
	createAnnouncement,
	type DeleteAnnouncementInput,
	deleteAnnouncement,
	listAdminAnnouncements,
	type UpdateAnnouncementInput,
	updateAnnouncement
} from '#lib/server/handlers/announcements.js';

export class AdminAnnouncements extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listAdminAnnouncements());
	}

	create(input: AnnouncementInput) {
		return inScope(this.#scope, () => createAnnouncement(input));
	}

	update(input: UpdateAnnouncementInput) {
		return inScope(this.#scope, () => updateAnnouncement(input));
	}

	delete(input: DeleteAnnouncementInput) {
		return inScope(this.#scope, () => deleteAnnouncement(input));
	}
}
