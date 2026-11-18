import { type } from 'arktype';
import {
	ticketAttachmentIds,
	ticketBody,
	ticketCategory,
	ticketSubject
} from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listTickets = query(() => backend((me) => me.support().list()));

const ticketParams = type({ ticketId: 'string' });
export const getTicket = query(ticketParams, (input) => backend((me) => me.support().get(input)));

const createTicketParams = type({
	projectId: 'string | null',
	vmId: 'string | null',
	category: ticketCategory,
	subject: ticketSubject,
	body: ticketBody,
	attachmentIds: ticketAttachmentIds
});
export const createTicket = command(createTicketParams, (input) =>
	backend((me) => me.support().create(input))
);

const replyParams = type({
	ticketId: 'string',
	body: ticketBody,
	attachmentIds: ticketAttachmentIds
});
export const replyToTicket = command(replyParams, (input) =>
	backend((me) => me.support().reply(input))
);

export const closeTicket = command(ticketParams, (input) =>
	backend((me) => me.support().close(input))
);
