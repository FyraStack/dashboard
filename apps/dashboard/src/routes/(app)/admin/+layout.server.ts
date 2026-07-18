import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';
import { listVmTypes } from '$lib/remote/vm-types.remote';
import { listImages } from '$lib/remote/images.remote';
import { listAdminUsers } from '$lib/remote/admin-users.remote';
import { listAllAdminVms } from '$lib/remote/admin-vms.remote';
import { listAdminProjects } from '$lib/remote/admin-projects.remote';
import { listIpamPrefixes } from '$lib/remote/ipam.remote';
import { initDrizzle } from '$lib/server/db';
import { requireAdmin } from '$lib/server/auth-context';
import { getFeatureFlags } from '$lib/server/feature-flags';

export const load: LayoutServerLoad = async ({ depends }) => {
	depends('app:feature-flags');
	depends('app:admin-users');
	depends('app:ipam-prefixes');
	depends('app:admin-vms');
	depends('app:admin-projects');
	const event = getRequestEvent();
	const userId = event?.locals.user?.id;

	if (!userId) {
		return {
			vmTypes: [],
			images: [],
			adminUsers: [],
			ipamPrefixes: [],
			adminVms: [],
			adminProjects: []
		};
	}

	await requireAdmin(initDrizzle(), userId);

	const [vmTypes, images, featureFlags, adminUsers, ipamPrefixes, adminVms, adminProjects] =
		await Promise.all([
			listVmTypes(),
			listImages(),
			getFeatureFlags(),
			listAdminUsers(),
			listIpamPrefixes(),
			listAllAdminVms(),
			listAdminProjects()
		]);

	return {
		vmTypes,
		images,
		featureFlags,
		adminUsers,
		ipamPrefixes,
		adminVms,
		adminProjects
	};
};
