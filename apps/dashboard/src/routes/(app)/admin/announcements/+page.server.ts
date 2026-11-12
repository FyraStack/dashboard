import { dependencies } from '#lib/dependencies.js';
import { listAdminAnnouncements } from '#lib/remote/announcements.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends }) => {
	depends(dependencies.admin.announcements);
	return { announcements: await listAdminAnnouncements() };
};
