import { redirect } from '@sveltejs/kit';
import { billingSetupTokenParam } from 'stack-shared/billing';
import { createServerPath } from 'stack-shared/routes';
import { dependencies } from '#lib/dependencies.js';
import { listImages } from '#lib/remote/images.remote.js';
import { listSshKeys } from '#lib/remote/ssh-keys.remote.js';
import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import { listVolumes } from '#lib/remote/volumes.remote.js';
import { backend } from '#lib/server/backend.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, parent, depends, url }) => {
	depends(
		dependencies.project.createServer,
		dependencies.app.sshKeys,
		dependencies.app.ipamPrefixes
	);
	const { featureFlags } = await parent();
	const billingSetupToken = url.searchParams.get(billingSetupTokenParam);
	if (billingSetupToken) {
		const cleanPath = createServerPath(params.projectid);
		const { paymentUrl } = await backend(
			async (me) =>
				await me.project(params.projectid).completeCreateServerBillingSetup({
					billingSetupToken,
					returnPath: cleanPath
				})
		);
		redirect(303, paymentUrl ?? cleanPath);
	}

	const [vmTypes, dbImages, volumes, sshKeys, createServerPage] = await Promise.all([
		listVmTypes(),
		listImages(),
		featureFlags.volumes ? listVolumes({ projectId: params.projectid }) : [],
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
