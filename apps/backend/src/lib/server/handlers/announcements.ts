import { and, count, desc, eq, gte, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { requireAdmin } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { announcementReads, announcements } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';

const MAX_UNREAD_SHOWN = 10;
const MAX_IMAGE_BYTES = 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export const announcementImageTypes = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif'
] as const;

export type AnnouncementImageType = (typeof announcementImageTypes)[number];

export interface AnnouncementImageInput {
	data: string;
	type: AnnouncementImageType;
}

export interface AnnouncementInput {
	body: string;
	image?: AnnouncementImageInput | null;
	linkLabel: string | null;
	linkUrl: string | null;
	published: boolean;
	title: string;
}

export interface UpdateAnnouncementInput extends AnnouncementInput {
	announcementId: string;
}

export interface DeleteAnnouncementInput {
	announcementId: string;
}

export interface MarkAnnouncementsReadInput {
	announcementIds: string[];
}

export interface AnnouncementImageLookupInput {
	announcementId: string;
}

const imageVersion = sql<
	number | null
>`case when ${announcements.imageData} is null then null else ${announcements.updatedAt} end`.mapWith(
	Number
);

function requireUser() {
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}
	return user;
}

async function requireCurrentAdmin() {
	const user = requireUser();
	const db = initDrizzle();
	await requireAdmin(db, user.id);
	return db;
}

function normalizeAnnouncement(input: AnnouncementInput) {
	const title = input.title.trim();
	const body = input.body.trim();
	if (!(title && body)) {
		error(400, 'Title and body are required');
	}

	const linkUrl = input.linkUrl?.trim() || null;
	if (linkUrl && !isWebUrl(linkUrl)) {
		error(400, 'Link must be an http(s) URL');
	}

	return {
		title,
		body,
		linkUrl,
		linkLabel: linkUrl ? input.linkLabel?.trim() || null : null
	};
}

function decodedBase64Bytes(base64: string) {
	const padding = base64.endsWith('==') ? 2 : Number(base64.endsWith('='));
	return (base64.length / 4) * 3 - padding;
}

function normalizeImage(image: AnnouncementImageInput | null | undefined) {
	if (image === undefined) {
		return {};
	}
	if (image === null) {
		return { imageData: null, imageType: null };
	}
	if (!announcementImageTypes.includes(image.type)) {
		error(400, 'Image must be a PNG, JPEG, WebP, or GIF');
	}
	if (image.data.length === 0 || image.data.length % 4 !== 0 || !BASE64_PATTERN.test(image.data)) {
		error(400, 'Image data must be base64');
	}
	if (decodedBase64Bytes(image.data) > MAX_IMAGE_BYTES) {
		error(400, 'Image must be 1 MB or smaller');
	}
	return { imageData: image.data, imageType: image.type };
}

function isWebUrl(value: string) {
	try {
		const { protocol } = new URL(value);
		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
}

export async function listUnreadAnnouncements() {
	const user = requireUser();
	const db = initDrizzle();

	const alreadyRead = db
		.select({ announcementId: announcementReads.announcementId })
		.from(announcementReads)
		.where(
			and(
				eq(announcementReads.announcementId, announcements.id),
				eq(announcementReads.userId, user.id)
			)
		);

	return await db
		.select({
			id: announcements.id,
			title: announcements.title,
			body: announcements.body,
			linkUrl: announcements.linkUrl,
			linkLabel: announcements.linkLabel,
			imageVersion,
			publishedAt: sql<number>`${announcements.publishedAt}`.mapWith(Number)
		})
		.from(announcements)
		.where(
			and(
				isNotNull(announcements.publishedAt),
				gte(announcements.publishedAt, new Date(user.createdAt).getTime()),
				notExists(alreadyRead)
			)
		)
		.orderBy(desc(announcements.publishedAt))
		.limit(MAX_UNREAD_SHOWN);
}

export async function markAnnouncementsRead({ announcementIds }: MarkAnnouncementsReadInput) {
	const user = requireUser();
	if (announcementIds.length === 0) {
		return;
	}

	const db = initDrizzle();
	const published = await db
		.select({ id: announcements.id })
		.from(announcements)
		.where(and(inArray(announcements.id, announcementIds), isNotNull(announcements.publishedAt)));
	if (published.length === 0) {
		return;
	}

	const readAt = Date.now();
	await db
		.insert(announcementReads)
		.values(published.map(({ id }) => ({ announcementId: id, userId: user.id, readAt })))
		.onConflictDoNothing();
}

export async function listAdminAnnouncements() {
	const db = await requireCurrentAdmin();

	return await db
		.select({
			id: announcements.id,
			title: announcements.title,
			body: announcements.body,
			linkUrl: announcements.linkUrl,
			linkLabel: announcements.linkLabel,
			imageVersion,
			publishedAt: announcements.publishedAt,
			createdAt: announcements.createdAt,
			updatedAt: announcements.updatedAt,
			readCount: count(announcementReads.userId)
		})
		.from(announcements)
		.leftJoin(announcementReads, eq(announcementReads.announcementId, announcements.id))
		.groupBy(announcements.id)
		.orderBy(desc(announcements.createdAt));
}

export async function createAnnouncement(input: AnnouncementInput) {
	const db = await requireCurrentAdmin();
	const now = Date.now();

	const [inserted] = await db
		.insert(announcements)
		.values({
			...normalizeAnnouncement(input),
			...normalizeImage(input.image),
			publishedAt: input.published ? now : null,
			createdAt: now,
			updatedAt: now
		})
		.returning({ id: announcements.id });

	return { id: inserted.id };
}

export async function updateAnnouncement({ announcementId, ...input }: UpdateAnnouncementInput) {
	const db = await requireCurrentAdmin();

	const existing = await db.query.announcements.findFirst({
		where: eq(announcements.id, announcementId)
	});
	if (!existing) {
		error(404, 'Announcement not found');
	}

	const now = Date.now();
	await db
		.update(announcements)
		.set({
			...normalizeAnnouncement(input),
			...normalizeImage(input.image),
			publishedAt: input.published ? (existing.publishedAt ?? now) : null,
			updatedAt: now
		})
		.where(eq(announcements.id, announcementId));
}

export async function deleteAnnouncement({ announcementId }: DeleteAnnouncementInput) {
	const db = await requireCurrentAdmin();

	const deleted = await db
		.delete(announcements)
		.where(eq(announcements.id, announcementId))
		.returning({ id: announcements.id });
	if (deleted.length === 0) {
		error(404, 'Announcement not found');
	}
}

export async function getAnnouncementImage({ announcementId }: AnnouncementImageLookupInput) {
	const user = requireUser();
	const db = initDrizzle();

	const [row] = await db
		.select({
			data: announcements.imageData,
			type: announcements.imageType,
			publishedAt: announcements.publishedAt
		})
		.from(announcements)
		.where(eq(announcements.id, announcementId))
		.limit(1);
	if (!(row?.data && row.type)) {
		error(404, 'Image not found');
	}
	if (row.publishedAt === null) {
		await requireAdmin(db, user.id);
	}

	return { data: row.data, type: row.type };
}
