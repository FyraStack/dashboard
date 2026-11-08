import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listAdminAnnouncements = query(() =>
	backend((me) => me.admin().announcements().list())
);

const announcementImage = type({
	type: "'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'",
	data: '0 < string <= 1400000'
});

const announcementFields = {
	'image?': announcementImage.or('null'),
	title: '0 < string <= 200',
	body: '0 < string <= 10000',
	linkUrl: 'string <= 2000 | null',
	linkLabel: 'string <= 100 | null',
	published: 'boolean'
} as const;

export const createAnnouncement = command(type(announcementFields), (input) =>
	backend((me) => me.admin().announcements().create(input))
);

export const updateAnnouncement = command(
	type({ announcementId: 'string', ...announcementFields }),
	(input) => backend((me) => me.admin().announcements().update(input))
);

export const deleteAnnouncement = command(type({ announcementId: 'string' }), (input) =>
	backend((me) => me.admin().announcements().delete(input))
);

export const markAnnouncementsRead = command(type({ announcementIds: 'string[] <= 50' }), (input) =>
	backend((me) => me.account().markAnnouncementsRead(input))
);

export const setAnnouncementsEnabled = command(type({ enabled: 'boolean' }), (input) =>
	backend((me) => me.account().setAnnouncementsEnabled(input))
);
