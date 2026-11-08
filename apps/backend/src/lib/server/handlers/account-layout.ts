import { hasAdminRole } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { listUnreadAnnouncements } from '#lib/server/handlers/announcements.js';
import { error } from '#lib/server/http.js';

export async function loadAppLayoutAccount() {
	const { user } = context().locals;
	if (!user) {
		error(401, 'Authentication required');
	}

	const [featureFlags, unreadAnnouncements] = await Promise.all([
		getFeatureFlags(),
		listUnreadAnnouncements()
	]);

	return {
		isAdmin: hasAdminRole(user.role) || user.isAdmin || false,
		featureFlags,
		unreadAnnouncements
	};
}
