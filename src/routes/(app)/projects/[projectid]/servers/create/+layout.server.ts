import type { LayoutServerLoad } from './$types';
import { listVmTypes } from '$lib/remote/vm-types.remote';
import { listImages } from '$lib/remote/images.remote';
import { listVolumes } from '$lib/remote/volumes.remote';
import { listSshKeys } from '$lib/remote/ssh-keys.remote';
import { error, redirect } from '@sveltejs/kit';
import { getProjectMemberRole } from '$lib/server/auth-context';
import { attachDefaultProjectPlan } from '$lib/server/billing/autumn';
import { getProjectBillingOverview, refreshProjectBilling } from '$lib/server/billing/overview';
import { initDrizzle } from '$lib/server/db';

export const load: LayoutServerLoad = async ({ locals, params, parent, depends, url }) => {
	depends('project:create-server');
	depends('app:ssh-keys');
	const { featureFlags } = await parent();
	if (!params.projectid) {
		error(404, 'Project not found');
	}
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const role = await getProjectMemberRole(db, locals.user.id, params.projectid);

	if (url.searchParams.get('billing_setup') === 'complete') {
		if (role !== 'owner') error(403, 'Project owner permission required');

		const cleanPath = `/projects/${params.projectid}/servers/create`;
		const paymentUrl = await attachDefaultProjectPlan(
			params.projectid,
			`${url.origin}${cleanPath}`
		);
		if (paymentUrl) redirect(303, paymentUrl);

		await refreshProjectBilling(params.projectid);
		redirect(303, cleanPath);
	}

	void refreshProjectBilling(params.projectid);
	const [vmTypes, dbImages, volumes, sshKeys, billing] = await Promise.all([
		listVmTypes(),
		listImages(),
		featureFlags?.volumes ? listVolumes({ projectId: params.projectid }) : [],
		listSshKeys(),
		getProjectBillingOverview(params.projectid)
	]);

	return {
		vmTypes,
		dbImages,
		volumes,
		sshKeys,
		billing,
		canManageBilling: role === 'owner'
	};
};
