import { requireAdminUser } from '#lib/server/auth-context.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { countTicketsAwaitingStaff } from '#lib/server/handlers/support.js';

export async function loadAdminLayout() {
	const { db } = await requireAdminUser();
	const [featureFlags, ticketsAwaitingStaff] = await Promise.all([
		getFeatureFlags(),
		countTicketsAwaitingStaff(db)
	]);

	return { featureFlags, ticketsAwaitingStaff };
}
