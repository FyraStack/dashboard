export const announcementImageTypes = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif'
] as const;

export type AnnouncementImageType = (typeof announcementImageTypes)[number];

export const MAX_ANNOUNCEMENT_IMAGE_BYTES = 1024 * 1024;
