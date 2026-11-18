import { isAdminUser, requireUser } from '#lib/server/auth-context.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { loadUserAnnouncements } from '#lib/server/handlers/announcements.js';
import { countTicketsAwaitingCustomer } from '#lib/server/handlers/support.js';

export async function loadAppLayoutAccount() {
	const { user } = requireUser();

	const [featureFlags, { announcementsEnabled, unreadAnnouncements }] = await Promise.all([
		getFeatureFlags(),
		loadUserAnnouncements()
	]);

	return {
		isAdmin: isAdminUser(user),
		featureFlags,
		announcementsEnabled,
		unreadAnnouncements,
		ticketsAwaitingReply: featureFlags.support ? await countTicketsAwaitingCustomer() : 0
	};
}
