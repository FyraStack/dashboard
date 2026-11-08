import { requireAdmin } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { error } from '#lib/server/http.js';

export async function loadAdminLayout() {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	await requireAdmin(initDrizzle(), locals.user.id);

	return { featureFlags: await getFeatureFlags() };
}
