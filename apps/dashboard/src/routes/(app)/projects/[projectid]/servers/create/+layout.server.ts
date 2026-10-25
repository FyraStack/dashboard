import { error, redirect } from '@sveltejs/kit';
import { listProjectImages } from '#lib/remote/custom-images.remote.js';
import { listSshKeys } from '#lib/remote/ssh-keys.remote.js';
import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import { listVolumes } from '#lib/remote/volumes.remote.js';
import { getProjectMemberRole } from '#lib/server/auth-context.js';
import { runInBackground } from '#lib/server/background.js';
import { attachDefaultProjectPlan } from '#lib/server/billing/autumn.js';
import { getProjectBillingReadiness, refreshProjectBilling } from '#lib/server/billing/overview.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { getIpamAvailability } from '#lib/server/ipam.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params, parent, depends, url }) => {
	depends('project:create-server');
	depends('app:ssh-keys');
	depends('app:ipam-prefixes');
	const { featureFlags } = await parent();
	if (!params.projectid) {
		error(404, 'Project not found');
	}
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();

	if (url.searchParams.get('billing_setup') === 'complete') {
		const role = await getProjectMemberRole(db, locals.user.id, params.projectid);
		if (role !== 'owner') {
			error(403, 'Project owner permission required');
		}

		const cleanPath = `/projects/${params.projectid}/servers/create`;
		const paymentUrl = await attachDefaultProjectPlan(
			params.projectid,
			`${url.origin}${cleanPath}`,
			url.searchParams.get('billing_promo') ?? undefined
		);
		if (paymentUrl) {
			redirect(303, paymentUrl);
		}

		await refreshProjectBilling(params.projectid);
		redirect(303, cleanPath);
	}

	runInBackground(refreshProjectBilling(params.projectid), 'refreshProjectBilling');
	const [vmTypes, images, volumes, sshKeys, billing, ipamAvailability, role] = await Promise.all([
		listVmTypes(),
		listProjectImages({ projectId: params.projectid }),
		featureFlags?.volumes ? listVolumes({ projectId: params.projectid }) : [],
		listSshKeys(),
		getProjectBillingReadiness(params.projectid),
		getIpamAvailability(db),
		getProjectMemberRole(db, locals.user.id, params.projectid)
	]);

	const dbImages = [
		...images.platformImages,
		...images.customImages
			.filter((image) => image.status === 'ready')
			.map((image) => ({
				id: image.id,
				name: image.name,
				version: image.version,
				description: image.description,
				imageType: image.imageType,
				isa: image.isa,
				secureBoot: image.secureBoot,
				isOfficial: false,
				isCustom: true,
				icon: null,
				color: 'bg-gray-600',
				logoSvg: null,
				accentColor: '#6b7280',
				minDiskGb: image.virtualSizeBytes ? Math.ceil(image.virtualSizeBytes / 1024 ** 3) : 0
			}))
	];

	return {
		vmTypes,
		dbImages,
		volumes,
		sshKeys,
		billing,
		ipamAvailability,
		canManageBilling: role === 'owner'
	};
};
