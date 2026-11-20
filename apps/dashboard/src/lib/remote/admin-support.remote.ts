import { type } from 'arktype';
import {
	ticketAttachmentIds,
	ticketBody,
	ticketCategory,
	ticketPriority,
	ticketStatus,
	ticketSubject
} from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listAdminTickets = query(() => backend((me) => me.admin().support().list()));

const ticketParams = type({ ticketId: 'string' });
export const getAdminTicket = query(ticketParams, (input) =>
	backend((me) => me.admin().support().get(input))
);

const replyParams = type({
	ticketId: 'string',
	body: ticketBody,
	attachmentIds: ticketAttachmentIds,
	internal: 'boolean'
});
export const replyToAdminTicket = command(replyParams, (input) =>
	backend((me) => me.admin().support().reply(input))
);

const updateParams = type({
	ticketId: 'string',
	'status?': ticketStatus,
	'priority?': ticketPriority,
	'category?': ticketCategory,
	'assigneeId?': 'string | null'
});
export const updateAdminTicket = command(updateParams, (input) =>
	backend((me) => me.admin().support().update(input))
);

const moveParams = type({ ticketId: 'string', projectId: 'string | null' });
export const moveAdminTicket = command(moveParams, (input) =>
	backend((me) => me.admin().support().move(input))
);

const createParams = type({
	target: type({ projectId: 'string' }).or({ userId: 'string' }),
	category: ticketCategory,
	subject: ticketSubject,
	body: ticketBody,
	attachmentIds: ticketAttachmentIds
});
export const createAdminTicket = command(createParams, (input) =>
	backend((me) => me.admin().support().create(input))
);
