import { and, count, desc, eq, exists, gt, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	MAX_TICKET_ATTACHMENTS,
	MAX_TICKET_MESSAGE_LENGTH,
	MAX_TICKET_SUBJECT_LENGTH,
	type TicketCategory,
	type TicketPriority,
	type TicketStatus
} from 'stack-shared/support';
import { adminUserCondition, requireAdminUser, requireUser } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import type { AppUser } from '#lib/server/context.js';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import {
	supportTicketAttachments,
	supportTicketMessages,
	supportTickets,
	vms
} from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import {
	notifyCustomersOfStaffMessage,
	notifyStaffOfCustomerMessage
} from '#lib/server/support-notifications.js';

const TICKET_LIST_LIMIT = 500;
const MAX_TICKETS_PER_HOUR = 10;
const MAX_MESSAGES_PER_TEN_MINUTES = 30;
const HOUR_MS = 3_600_000;
const TEN_MINUTES_MS = 600_000;
const DELETED_USER_NAME = 'Deleted user';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TicketMessageInput {
	attachmentIds: string[];
	body: string;
}

export interface CreateTicketInput extends TicketMessageInput {
	category: TicketCategory;
	projectId: string | null;
	subject: string;
	vmId: string | null;
}

export interface TicketLookupInput {
	ticketId: string;
}

export interface ReplyToTicketInput extends TicketMessageInput, TicketLookupInput {}

export interface StaffReplyInput extends ReplyToTicketInput {
	internal: boolean;
}

export interface UpdateTicketInput extends TicketLookupInput {
	assigneeId?: string | null;
	category?: TicketCategory;
	priority?: TicketPriority;
	status?: TicketStatus;
}

export interface MoveTicketInput extends TicketLookupInput {
	projectId: string | null;
}

export interface CreateStaffTicketInput extends TicketMessageInput {
	category: TicketCategory;
	subject: string;
	target: { projectId: string } | { userId: string };
}

const requester = alias(user, 'ticket_requester');
const assignee = alias(user, 'ticket_assignee');
const author = alias(user, 'message_author');

const ticketColumns = {
	id: supportTickets.id,
	number: supportTickets.number,
	subject: supportTickets.subject,
	category: supportTickets.category,
	status: supportTickets.status,
	priority: supportTickets.priority,
	openedByStaff: supportTickets.openedByStaff,
	createdAt: supportTickets.createdAt,
	updatedAt: supportTickets.updatedAt,
	closedAt: supportTickets.closedAt,
	purgeAt: supportTickets.purgeAt,
	projectId: supportTickets.projectId,
	projectName: organization.name,
	projectDeletedAt: organization.deletedAt,
	vmId: supportTickets.vmId,
	vmName: vms.name,
	requesterId: requester.id,
	requesterName: requester.name,
	requesterEmail: requester.email,
	assigneeId: assignee.id,
	assigneeName: assignee.name
};

function selectTickets(db: Database) {
	return db
		.select(ticketColumns)
		.from(supportTickets)
		.leftJoin(organization, eq(organization.id, supportTickets.projectId))
		.leftJoin(vms, eq(vms.id, supportTickets.vmId))
		.leftJoin(requester, eq(requester.id, supportTickets.requesterUserId))
		.leftJoin(assignee, eq(assignee.id, supportTickets.assigneeUserId));
}

type TicketRow = Awaited<ReturnType<typeof selectTickets>>[number];

function visibleToCustomer(db: Database, userId: string) {
	const membership = db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, supportTickets.projectId), eq(member.userId, userId)));

	return and(
		isNull(supportTickets.purgeAt),
		or(
			and(isNull(supportTickets.projectId), eq(supportTickets.requesterUserId, userId)),
			and(isNull(organization.deletedAt), exists(membership))
		)
	);
}

export async function requireCustomerTicket(db: Database, userId: string, ticketId: string) {
	const [ticket] = await selectTickets(db)
		.where(and(eq(supportTickets.id, ticketId), visibleToCustomer(db, userId)))
		.limit(1);
	if (!ticket) {
		error(404, 'Ticket not found');
	}
	return ticket;
}

async function requireStaffTicket(db: Database, ticketId: string) {
	const [ticket] = await selectTickets(db).where(eq(supportTickets.id, ticketId)).limit(1);
	if (!ticket) {
		error(404, 'Ticket not found');
	}
	return ticket;
}

async function loadThread(db: Database, ticketId: string, includeInternal: boolean) {
	const messages = await db
		.select({
			id: supportTicketMessages.id,
			authorName: author.name,
			staff: supportTicketMessages.staff,
			internal: supportTicketMessages.internal,
			body: supportTicketMessages.body,
			createdAt: supportTicketMessages.createdAt
		})
		.from(supportTicketMessages)
		.leftJoin(author, eq(author.id, supportTicketMessages.authorUserId))
		.where(
			and(
				eq(supportTicketMessages.ticketId, ticketId),
				includeInternal ? undefined : eq(supportTicketMessages.internal, false)
			)
		)
		.orderBy(supportTicketMessages.createdAt, supportTicketMessages.id);

	const messageIds = messages.map(({ id }) => id);
	const attachments =
		messageIds.length === 0
			? []
			: await db
					.select({
						id: supportTicketAttachments.id,
						messageId: supportTicketAttachments.messageId,
						name: supportTicketAttachments.name,
						size: supportTicketAttachments.size
					})
					.from(supportTicketAttachments)
					.where(inArray(supportTicketAttachments.messageId, messageIds))
					.orderBy(supportTicketAttachments.createdAt, supportTicketAttachments.id);

	return messages.map((message) => ({
		...message,
		authorName: message.authorName ?? DELETED_USER_NAME,
		attachments: attachments
			.filter(({ messageId }) => messageId === message.id)
			.map(({ id, name, size }) => ({ id, name, size }))
	}));
}

function customerSummary(ticket: TicketRow) {
	return {
		id: ticket.id,
		number: ticket.number,
		subject: ticket.subject,
		category: ticket.category,
		status: ticket.status,
		project:
			ticket.projectId && ticket.projectName
				? { id: ticket.projectId, name: ticket.projectName }
				: null,
		vm: ticket.vmId && ticket.vmName ? { id: ticket.vmId, name: ticket.vmName } : null,
		requesterName: ticket.requesterName ?? DELETED_USER_NAME,
		openedByStaff: ticket.openedByStaff,
		createdAt: ticket.createdAt,
		updatedAt: ticket.updatedAt
	};
}

function staffSummary(ticket: TicketRow) {
	return {
		...customerSummary(ticket),
		priority: ticket.priority,
		requester:
			ticket.requesterId && ticket.requesterEmail
				? {
						id: ticket.requesterId,
						name: ticket.requesterName ?? ticket.requesterEmail,
						email: ticket.requesterEmail
					}
				: null,
		assignee:
			ticket.assigneeId && ticket.assigneeName
				? { id: ticket.assigneeId, name: ticket.assigneeName }
				: null
	};
}

function displayName(person: Pick<AppUser, 'email' | 'name'>) {
	return person.name || person.email;
}

function requireText(value: string, label: string, maxLength: number) {
	const text = value.trim();
	if (!text || text.length > maxLength) {
		error(400, `${label} must be between 1 and ${maxLength} characters`);
	}
	return text;
}

export async function isStaff(db: Database, userId: string) {
	const [staffMember] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, userId), adminUserCondition))
		.limit(1);
	return Boolean(staffMember);
}

async function requireProjectMembership(db: Database, userId: string, projectId: string) {
	const [project] = await db
		.select({ id: organization.id })
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(
			and(eq(organization.id, projectId), eq(member.userId, userId), isNull(organization.deletedAt))
		)
		.limit(1);
	if (!project) {
		error(404, 'Project not found');
	}
}

async function requireProjectVm(db: Database, projectId: string, vmId: string) {
	const [vm] = await db
		.select({ id: vms.id })
		.from(vms)
		.where(and(eq(vms.id, vmId), eq(vms.ownerProjectId, projectId), eq(vms.active, true)))
		.limit(1);
	if (!vm) {
		error(400, 'Server not found in this project');
	}
}

async function enforceTicketRateLimit(db: Database, userId: string) {
	const recent = await db.$count(
		supportTickets,
		and(
			eq(supportTickets.requesterUserId, userId),
			eq(supportTickets.openedByStaff, false),
			gt(supportTickets.createdAt, Date.now() - HOUR_MS)
		)
	);
	if (recent >= MAX_TICKETS_PER_HOUR) {
		error(429, 'You have opened several tickets recently. Wait a while before opening another.');
	}
}

async function enforceMessageRateLimit(db: Database, userId: string) {
	const recent = await db.$count(
		supportTicketMessages,
		and(
			eq(supportTicketMessages.authorUserId, userId),
			eq(supportTicketMessages.staff, false),
			gt(supportTicketMessages.createdAt, Date.now() - TEN_MINUTES_MS)
		)
	);
	if (recent >= MAX_MESSAGES_PER_TEN_MINUTES) {
		error(429, 'You are sending messages too quickly. Wait a few minutes and try again.');
	}
}

interface NewMessage extends TicketMessageInput {
	authorUserId: string;
	internal?: boolean;
	staff: boolean;
	ticketId: string;
}

async function insertMessage(tx: Transaction, { attachmentIds, ...message }: NewMessage) {
	const uploadIds = [...new Set(attachmentIds)];
	if (uploadIds.length > MAX_TICKET_ATTACHMENTS) {
		error(400, `You can attach up to ${MAX_TICKET_ATTACHMENTS} files per message`);
	}

	const [{ id: messageId }] = await tx
		.insert(supportTicketMessages)
		.values({ ...message, createdAt: Date.now() })
		.returning({ id: supportTicketMessages.id });
	if (uploadIds.length === 0) {
		return;
	}

	const attached = await tx
		.update(supportTicketAttachments)
		.set({ messageId })
		.where(
			and(
				inArray(supportTicketAttachments.id, uploadIds),
				eq(supportTicketAttachments.uploaderUserId, message.authorUserId),
				isNull(supportTicketAttachments.messageId)
			)
		)
		.returning({ id: supportTicketAttachments.id });
	if (attached.length !== uploadIds.length) {
		error(400, 'One of the attachments could not be found. Upload it again.');
	}
}

async function openTicket(
	db: Database,
	ticket: Omit<typeof supportTickets.$inferInsert, 'createdAt' | 'updatedAt'>,
	message: Omit<NewMessage, 'ticketId'>
) {
	const now = Date.now();
	const ticketId = await db.transaction(async (tx) => {
		const [{ id }] = await tx
			.insert(supportTickets)
			.values({ ...ticket, createdAt: now, updatedAt: now })
			.returning({ id: supportTickets.id });
		await insertMessage(tx, { ...message, ticketId: id });
		return id;
	});
	return requireStaffTicket(db, ticketId);
}

async function postReply(db: Database, message: NewMessage, status: TicketStatus | null) {
	await db.transaction(async (tx) => {
		await insertMessage(tx, message);
		if (status) {
			await tx
				.update(supportTickets)
				.set({ status, closedAt: null, updatedAt: Date.now() })
				.where(eq(supportTickets.id, message.ticketId));
		}
	});
}

export async function listTickets() {
	const { db, user: viewer } = requireUser();
	const tickets = await selectTickets(db)
		.where(visibleToCustomer(db, viewer.id))
		.orderBy(desc(supportTickets.updatedAt))
		.limit(TICKET_LIST_LIMIT);
	return tickets.map(customerSummary);
}

export async function countTicketsAwaitingCustomer() {
	const { db, user: viewer } = requireUser();
	const [{ awaiting }] = await db
		.select({ awaiting: count() })
		.from(supportTickets)
		.leftJoin(organization, eq(organization.id, supportTickets.projectId))
		.where(and(eq(supportTickets.status, 'pending'), visibleToCustomer(db, viewer.id)));
	return awaiting;
}

export async function getTicket({ ticketId }: TicketLookupInput) {
	const { db, user: viewer } = requireUser();
	const ticket = await requireCustomerTicket(db, viewer.id, ticketId);
	return {
		...customerSummary(ticket),
		canClose: !ticket.openedByStaff,
		messages: await loadThread(db, ticketId, false)
	};
}

export async function createTicket(input: CreateTicketInput) {
	const { db, user: viewer } = requireUser();
	const subject = requireText(input.subject, 'Subject', MAX_TICKET_SUBJECT_LENGTH);
	const body = requireText(input.body, 'Message', MAX_TICKET_MESSAGE_LENGTH);
	if (input.vmId && !input.projectId) {
		error(400, 'A server can only be attached to a project ticket');
	}
	if (input.projectId) {
		await requireProjectMembership(db, viewer.id, input.projectId);
	}
	if (input.projectId && input.vmId) {
		await requireProjectVm(db, input.projectId, input.vmId);
	}
	await enforceTicketRateLimit(db, viewer.id);

	const ticket = await openTicket(
		db,
		{
			subject,
			category: input.category,
			status: 'open',
			projectId: input.projectId,
			vmId: input.vmId,
			requesterUserId: viewer.id,
			openedByStaff: false
		},
		{ authorUserId: viewer.id, staff: false, body, attachmentIds: input.attachmentIds }
	);
	runInBackground(
		notifyStaffOfCustomerMessage(db, ticket, displayName(viewer), viewer.email, 'opened', body),
		`notify staff of new ticket ${ticket.id}`
	);

	return { id: ticket.id };
}

export async function replyToTicket(input: ReplyToTicketInput) {
	const { db, user: viewer } = requireUser();
	const body = requireText(input.body, 'Message', MAX_TICKET_MESSAGE_LENGTH);
	const ticket = await requireCustomerTicket(db, viewer.id, input.ticketId);
	await enforceMessageRateLimit(db, viewer.id);

	await postReply(
		db,
		{
			ticketId: ticket.id,
			authorUserId: viewer.id,
			staff: false,
			body,
			attachmentIds: input.attachmentIds
		},
		'open'
	);
	runInBackground(
		notifyStaffOfCustomerMessage(db, ticket, displayName(viewer), viewer.email, 'replied', body),
		`notify staff of reply on ticket ${ticket.id}`
	);
}

export async function closeTicket({ ticketId }: TicketLookupInput) {
	const { db, user: viewer } = requireUser();
	const ticket = await requireCustomerTicket(db, viewer.id, ticketId);
	if (ticket.openedByStaff) {
		error(403, 'Only staff can close this ticket');
	}

	const now = Date.now();
	await db
		.update(supportTickets)
		.set({ status: 'closed', closedAt: now, updatedAt: now })
		.where(eq(supportTickets.id, ticket.id));
}

export async function listStaffTickets() {
	const { db } = await requireAdminUser();
	const tickets = await selectTickets(db)
		.orderBy(desc(supportTickets.updatedAt))
		.limit(TICKET_LIST_LIMIT);
	return tickets.map(staffSummary);
}

export function countTicketsAwaitingStaff(db: Database) {
	return db.$count(supportTickets, eq(supportTickets.status, 'open'));
}

export async function getStaffTicket({ ticketId }: TicketLookupInput) {
	const { db } = await requireAdminUser();
	const ticket = await requireStaffTicket(db, ticketId);
	return { ...staffSummary(ticket), messages: await loadThread(db, ticketId, true) };
}

export async function replyToTicketAsStaff(input: StaffReplyInput) {
	const { db, user: staff } = await requireAdminUser();
	const body = requireText(input.body, 'Message', MAX_TICKET_MESSAGE_LENGTH);
	const ticket = await requireStaffTicket(db, input.ticketId);

	await postReply(
		db,
		{
			ticketId: ticket.id,
			authorUserId: staff.id,
			staff: true,
			internal: input.internal,
			body,
			attachmentIds: input.attachmentIds
		},
		input.internal ? null : 'pending'
	);
	if (!input.internal && ticket.purgeAt === null && ticket.projectDeletedAt === null) {
		runInBackground(
			notifyCustomersOfStaffMessage(db, ticket, displayName(staff), 'replied', body),
			`notify customers of staff reply on ticket ${ticket.id}`
		);
	}
}

export async function updateTicket({ ticketId, ...changes }: UpdateTicketInput) {
	const { db } = await requireAdminUser();
	await requireStaffTicket(db, ticketId);
	if (changes.assigneeId && !(await isStaff(db, changes.assigneeId))) {
		error(400, 'Tickets can only be assigned to staff');
	}

	const now = Date.now();
	await db
		.update(supportTickets)
		.set({
			assigneeUserId: changes.assigneeId,
			category: changes.category,
			priority: changes.priority,
			...(changes.status && {
				status: changes.status,
				closedAt: changes.status === 'closed' ? now : null,
				updatedAt: now
			})
		})
		.where(eq(supportTickets.id, ticketId));
}

export async function moveTicket({ ticketId, projectId }: MoveTicketInput) {
	const { db } = await requireAdminUser();
	const ticket = await requireStaffTicket(db, ticketId);
	if (ticket.projectId === projectId) {
		return;
	}
	if (projectId === null && ticket.requesterId === null) {
		error(400, 'This ticket has no requester to move it to');
	}
	if (projectId !== null) {
		const [project] = await db
			.select({ id: organization.id })
			.from(organization)
			.where(and(eq(organization.id, projectId), isNull(organization.deletedAt)))
			.limit(1);
		if (!project) {
			error(400, 'Project not found');
		}
	}

	await db
		.update(supportTickets)
		.set({ projectId, vmId: null })
		.where(eq(supportTickets.id, ticketId));
}

async function staffTicketAddressee(db: Database, target: CreateStaffTicketInput['target']) {
	if ('userId' in target) {
		const [addressee] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, target.userId))
			.limit(1);
		if (!addressee) {
			error(400, 'User not found');
		}
		return { projectId: null, requesterUserId: addressee.id };
	}

	const [owner] = await db
		.select({ userId: member.userId })
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(
			and(
				eq(member.organizationId, target.projectId),
				eq(member.role, 'owner'),
				isNull(organization.deletedAt)
			)
		)
		.limit(1);
	if (!owner) {
		error(400, 'This project has no owner to address the ticket to');
	}
	return { projectId: target.projectId, requesterUserId: owner.userId };
}

export async function createStaffTicket(input: CreateStaffTicketInput) {
	const { db, user: staff } = await requireAdminUser();
	const subject = requireText(input.subject, 'Subject', MAX_TICKET_SUBJECT_LENGTH);
	const body = requireText(input.body, 'Message', MAX_TICKET_MESSAGE_LENGTH);
	const addressee = await staffTicketAddressee(db, input.target);

	const ticket = await openTicket(
		db,
		{ ...addressee, subject, category: input.category, status: 'pending', openedByStaff: true },
		{ authorUserId: staff.id, staff: true, body, attachmentIds: input.attachmentIds }
	);
	runInBackground(
		notifyCustomersOfStaffMessage(db, ticket, displayName(staff), 'opened', body),
		`notify customer of staff ticket ${ticket.id}`
	);

	return { id: ticket.id };
}

export function scheduleAccountTicketPurge(db: Database, userId: string, purgeAt: number) {
	return db
		.update(supportTickets)
		.set({ purgeAt })
		.where(and(eq(supportTickets.requesterUserId, userId), isNull(supportTickets.projectId)));
}
