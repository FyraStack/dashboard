import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type CreateStaffTicketInput,
	createStaffTicket,
	getStaffTicket,
	listStaffTickets,
	type MoveTicketInput,
	moveTicket,
	replyToTicketAsStaff,
	type StaffReplyInput,
	type TicketLookupInput,
	type UpdateTicketInput,
	updateTicket
} from '#lib/server/handlers/support.js';
import { inScope } from '#lib/server/scope.js';

export class AdminSupport extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listStaffTickets());
	}

	get(input: TicketLookupInput) {
		return inScope(this.#scope, () => getStaffTicket(input));
	}

	create(input: CreateStaffTicketInput) {
		return inScope(this.#scope, () => createStaffTicket(input));
	}

	reply(input: StaffReplyInput) {
		return inScope(this.#scope, () => replyToTicketAsStaff(input));
	}

	update(input: UpdateTicketInput) {
		return inScope(this.#scope, () => updateTicket(input));
	}

	move(input: MoveTicketInput) {
		return inScope(this.#scope, () => moveTicket(input));
	}
}
