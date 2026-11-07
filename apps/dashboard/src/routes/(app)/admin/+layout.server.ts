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
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends, locals }) => {
	depends('app:feature-flags');
	depends('app:admin-users');
	depends('app:ipam-prefixes');
	depends('app:admin-vms');
	depends('app:admin-projects');

	if (!locals.user?.id) {
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

	const [{ featureFlags }, vmTypes, images, adminUsers, ipamPrefixes, adminVms, adminProjects] =
		await Promise.all([
			backend((me) => me.admin().layout()),
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
		featureFlags,
		adminUsers,
		ipamPrefixes,
		adminVms,
		adminProjects
	};
};
