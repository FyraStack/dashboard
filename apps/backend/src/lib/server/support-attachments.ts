import { env } from 'cloudflare:workers';
import { and, eq, gt, isNull, lt, type SQL } from 'drizzle-orm';
import { decodeHttpError } from 'stack-shared/http-error';
import { supportAttachmentNameHeader, supportAttachmentsPath } from 'stack-shared/routes';
import {
	MAX_TICKET_ATTACHMENT_BYTES,
	MAX_TICKET_ATTACHMENT_NAME_LENGTH
} from 'stack-shared/support';
import { ulid } from 'ulid';
import { requireUser } from '#lib/server/auth-context.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import {
	supportTicketAttachments,
	supportTicketMessages,
	supportTickets
} from '#lib/server/db/schema.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { isStaff, requireCustomerTicket } from '#lib/server/handlers/support.js';
import { error } from '#lib/server/http.js';
import { inScope } from '#lib/server/scope.js';

const ABANDONED_UPLOAD_AGE_MS = 86_400_000;
const MAX_PENDING_UPLOADS = 40;
const OBJECT_DELETE_BATCH = 1000;

function objectKey(attachmentId: string) {
	return `attachments/${attachmentId}`;
}

async function requireSupportEnabled() {
	const { support } = await getFeatureFlags();
	if (!support) {
		error(404, 'Not found');
	}
}

function attachmentName(request: Request) {
	const encoded = request.headers.get(supportAttachmentNameHeader) ?? '';
	let name: string;
	try {
		name = decodeURIComponent(encoded).trim();
	} catch {
		error(400, 'Attachment name is not valid');
	}
	if (!name || name.length > MAX_TICKET_ATTACHMENT_NAME_LENGTH) {
		error(400, 'Attachment name is not valid');
	}
	return name;
}

function requireAllowedSize(bytes: number) {
	if (bytes > MAX_TICKET_ATTACHMENT_BYTES) {
		error(413, 'Attachment is too large');
	}
}

async function requireUploadCapacity(db: Database, userId: string) {
	const pending = await db.$count(
		supportTicketAttachments,
		and(
			eq(supportTicketAttachments.uploaderUserId, userId),
			isNull(supportTicketAttachments.messageId),
			gt(supportTicketAttachments.createdAt, Date.now() - ABANDONED_UPLOAD_AGE_MS)
		)
	);
	if (pending >= MAX_PENDING_UPLOADS) {
		error(429, 'Too many files uploaded without being sent. Try again later.');
	}
}

async function uploadAttachment(request: Request) {
	await requireSupportEnabled();
	const { db, user: uploader } = requireUser();
	const name = attachmentName(request);
	requireAllowedSize(Number(request.headers.get('content-length') ?? 0));
	await requireUploadCapacity(db, uploader.id);

	const bytes = await request.arrayBuffer();
	requireAllowedSize(bytes.byteLength);

	const id = ulid();
	await db.insert(supportTicketAttachments).values({
		id,
		uploaderUserId: uploader.id,
		name,
		size: bytes.byteLength,
		createdAt: Date.now()
	});
	try {
		await env.SUPPORT_ATTACHMENTS.put(objectKey(id), bytes);
	} catch (cause) {
		await db.delete(supportTicketAttachments).where(eq(supportTicketAttachments.id, id));
		throw cause;
	}

	return Response.json({ id });
}

async function requireReadableAttachment(db: Database, userId: string, attachmentId: string) {
	const [attachment] = await db
		.select({
			name: supportTicketAttachments.name,
			uploaderUserId: supportTicketAttachments.uploaderUserId,
			ticketId: supportTicketMessages.ticketId,
			internal: supportTicketMessages.internal
		})
		.from(supportTicketAttachments)
		.leftJoin(
			supportTicketMessages,
			eq(supportTicketMessages.id, supportTicketAttachments.messageId)
		)
		.where(eq(supportTicketAttachments.id, attachmentId))
		.limit(1);
	if (!attachment) {
		error(404, 'Attachment not found');
	}
	if (attachment.ticketId === null) {
		if (attachment.uploaderUserId !== userId) {
			error(404, 'Attachment not found');
		}
		return attachment;
	}
	if (await isStaff(db, userId)) {
		return attachment;
	}
	if (attachment.internal) {
		error(404, 'Attachment not found');
	}
	await requireCustomerTicket(db, userId, attachment.ticketId);
	return attachment;
}

async function downloadAttachment(attachmentId: string) {
	await requireSupportEnabled();
	const { db, user: viewer } = requireUser();
	const attachment = await requireReadableAttachment(db, viewer.id, attachmentId);
	const object = await env.SUPPORT_ATTACHMENTS.get(objectKey(attachmentId));
	if (!object) {
		error(404, 'Attachment not found');
	}

	return new Response(object.body, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': String(object.size),
			'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store'
		}
	});
}

function routeAttachmentRequest(request: Request) {
	const { pathname } = new URL(request.url);
	const scope = { headers: request.headers, url: request.url };

	if (request.method === 'POST' && pathname === supportAttachmentsPath) {
		if (request.headers.get('origin') !== new URL(env.ORIGIN).origin) {
			return new Response('Forbidden', { status: 403 });
		}
		return inScope(scope, () => uploadAttachment(request));
	}
	if (request.method === 'GET' && pathname.startsWith(`${supportAttachmentsPath}/`)) {
		const attachmentId = pathname.slice(supportAttachmentsPath.length + 1);
		return inScope(scope, () => downloadAttachment(attachmentId));
	}
	return new Response('Method not allowed', { status: 405 });
}

export async function handleSupportAttachmentRequest(request: Request) {
	try {
		return await routeAttachmentRequest(request);
	} catch (cause) {
		const httpError = decodeHttpError(cause);
		if (!httpError) {
			console.error('Support attachment request failed', cause);
		}
		return new Response(httpError?.message ?? 'Attachment request failed', {
			status: httpError?.status ?? 500
		});
	}
}

async function deleteObjects(attachmentIds: string[]) {
	for (let start = 0; start < attachmentIds.length; start += OBJECT_DELETE_BATCH) {
		const batch = attachmentIds.slice(start, start + OBJECT_DELETE_BATCH).map(objectKey);
		// biome-ignore lint/performance/noAwaitInLoops: object deletes are sent in bounded batches one at a time
		await env.SUPPORT_ATTACHMENTS.delete(batch);
	}
}

async function deleteTicketFiles(db: Database, tickets: SQL | undefined) {
	const attachments = await db
		.select({ id: supportTicketAttachments.id })
		.from(supportTicketAttachments)
		.innerJoin(
			supportTicketMessages,
			eq(supportTicketMessages.id, supportTicketAttachments.messageId)
		)
		.innerJoin(supportTickets, eq(supportTickets.id, supportTicketMessages.ticketId))
		.where(tickets);
	await deleteObjects(attachments.map(({ id }) => id));
}

export function deleteProjectSupportFiles(db: Database, projectId: string) {
	return deleteTicketFiles(db, eq(supportTickets.projectId, projectId));
}

export async function purgeExpiredSupportTickets(now = Date.now()) {
	const db = initDrizzle();
	const expired = lt(supportTickets.purgeAt, now);
	await deleteTicketFiles(db, expired);
	const purged = await db
		.delete(supportTickets)
		.where(expired)
		.returning({ id: supportTickets.id });
	return { purged: purged.length };
}

export async function purgeAbandonedSupportUploads(now = Date.now()) {
	const db = initDrizzle();
	const abandoned = and(
		isNull(supportTicketAttachments.messageId),
		lt(supportTicketAttachments.createdAt, now - ABANDONED_UPLOAD_AGE_MS)
	);
	const uploads = await db
		.select({ id: supportTicketAttachments.id })
		.from(supportTicketAttachments)
		.where(abandoned);
	await deleteObjects(uploads.map(({ id }) => id));
	await db.delete(supportTicketAttachments).where(abandoned);
	return { purged: uploads.length };
}
