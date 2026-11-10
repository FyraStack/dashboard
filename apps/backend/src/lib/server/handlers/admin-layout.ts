import { requireAdminUser } from '#lib/server/auth-context.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';

export async function loadAdminLayout() {
	await requireAdminUser();

	return { featureFlags: await getFeatureFlags() };
}
