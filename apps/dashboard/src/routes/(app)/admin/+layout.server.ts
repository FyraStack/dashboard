import { dependencies } from '#lib/dependencies.js';
import { listAdminProjects } from '#lib/remote/admin-projects.remote.js';
import { listAdminUsers } from '#lib/remote/admin-users.remote.js';
import { listAllAdminVms } from '#lib/remote/admin-vms.remote.js';
import { listImages } from '#lib/remote/images.remote.js';
import { listIpamPrefixes } from '#lib/remote/ipam.remote.js';
import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ depends }) => {
	depends(
		dependencies.admin.featureFlags,
		dependencies.admin.users,
		dependencies.admin.ipamPrefixes,
		dependencies.admin.vms,
		dependencies.admin.projects,
		dependencies.admin.vmTypes,
		dependencies.admin.images
	);

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
