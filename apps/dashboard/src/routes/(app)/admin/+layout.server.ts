import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';
import { listVmTypes } from '$lib/remote/vm-types.remote';
import { listImages } from '$lib/remote/images.remote';
import { listAdminUsers } from '$lib/remote/admin-users.remote';
import { listIpamPrefixes } from '$lib/remote/ipam.remote';
import { initDrizzle } from '$lib/server/db';
import { requireAdmin } from '$lib/server/auth-context';
import { getFeatureFlags } from '$lib/server/feature-flags';

export const load: LayoutServerLoad = async ({ depends }) => {
	depends('app:feature-flags');
	depends('app:admin-users');
	depends('app:ipam-prefixes');
	const event = getRequestEvent();
	const userId = event?.locals.user?.id;

	if (!userId) {
		return {
			vmTypes: [],
			images: [],
			adminUsers: [],
			ipamPrefixes: []
		};
	}

	await requireAdmin(initDrizzle(), userId);

	const [vmTypes, images, featureFlags, adminUsers, ipamPrefixes] = await Promise.all([
		listVmTypes(),
		listImages(),
		getFeatureFlags(),
		listAdminUsers(),
		listIpamPrefixes()
	]);

	return {
		vmTypes,
		images,
		featureFlags,
		adminUsers,
		ipamPrefixes
	};
};
