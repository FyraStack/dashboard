import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type CreateTicketInput,
	closeTicket,
	createTicket,
	getTicket,
	listTickets,
	type ReplyToTicketInput,
	replyToTicket,
	type TicketLookupInput
} from '#lib/server/handlers/support.js';
import { inScope } from '#lib/server/scope.js';

export class Support extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listTickets());
	}

	get(input: TicketLookupInput) {
		return inScope(this.#scope, () => getTicket(input));
	}

	create(input: CreateTicketInput) {
		return inScope(this.#scope, () => createTicket(input));
	}

	reply(input: ReplyToTicketInput) {
		return inScope(this.#scope, () => replyToTicket(input));
	}

	close(input: TicketLookupInput) {
		return inScope(this.#scope, () => closeTicket(input));
	}
}
