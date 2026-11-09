import { listAdminAnnouncements } from '#lib/remote/announcements.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
	depends('app:admin-announcements');
	return { announcements: await listAdminAnnouncements() };
};
