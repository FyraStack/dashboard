import { listAdminProjects } from '#lib/remote/admin-projects.remote.js';
import { listAdminUsers } from '#lib/remote/admin-users.remote.js';
import { listAllAdminVms } from '#lib/remote/admin-vms.remote.js';
import { listImages } from '#lib/remote/images.remote.js';
import { listIpamPrefixes } from '#lib/remote/ipam.remote.js';
import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureFeatureFlags
} from '#lib/server/accessibility-fixtures.js';
import { requireAdmin } from '#lib/server/auth-context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { getRequestEvent } from '$app/server';
import type { LayoutServerLoad } from './$types';

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

	if (accessibilityFixtureEnabled) {
		const [vmTypes, images, adminUsers, ipamPrefixes, adminVms, adminProjects] = await Promise.all([
			listVmTypes(),
			listImages(),
			listAdminUsers(),
			listIpamPrefixes(),
			listAllAdminVms(),
			listAdminProjects()
		]);
		return {
			vmTypes,
			images,
			featureFlags: accessibilityFixtureFeatureFlags,
			adminUsers,
			ipamPrefixes,
			adminVms,
			adminProjects
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
