import { error, redirect } from '@sveltejs/kit';
import { listImages } from '#lib/remote/images.remote.js';
import { listSshKeys } from '#lib/remote/ssh-keys.remote.js';
import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import { listVolumes } from '#lib/remote/volumes.remote.js';
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, parent, depends, url }) => {
	depends('project:create-server');
	depends('app:ssh-keys');
	depends('app:ipam-prefixes');
	const { featureFlags } = await parent();
	if (!params.projectid) {
		error(404, 'Project not found');
	}

	if (url.searchParams.get('billing_setup') === 'complete') {
		const cleanPath = `/projects/${params.projectid}/servers/create`;
		const { paymentUrl } = await backend(
			async (me) =>
				await me.project(params.projectid).completeCreateServerBillingSetup({
					returnPath: cleanPath,
					promoCode: url.searchParams.get('billing_promo') ?? undefined
				})
		);
		redirect(303, paymentUrl ?? cleanPath);
	}

	const [vmTypes, dbImages, volumes, sshKeys, createServerPage] = await Promise.all([
		listVmTypes(),
		listImages(),
		featureFlags?.volumes ? listVolumes({ projectId: params.projectid }) : [],
		listSshKeys(),
		backend((me) => me.project(params.projectid).createServerPage())
	]);

	return {
		vmTypes,
		dbImages,
		volumes,
		sshKeys,
		billing: createServerPage.billing,
		ipamAvailability: createServerPage.ipamAvailability,
		canManageBilling: createServerPage.canManageBilling
	};
};
