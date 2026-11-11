import { dependencies } from '#lib/dependencies.js';
import { requireFeature } from '#lib/feature-gate.js';
import { listVms } from '#lib/remote/vms.remote.js';
import { listVolumes } from '#lib/remote/volumes.remote.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent, depends }) => {
	depends(dependencies.project.volumes, dependencies.project.vms);
	await requireFeature(parent, 'volumes');

	const [volumes, vms] = await Promise.all([
		listVolumes({ projectId: params.projectid }),
		listVms({ projectId: params.projectid })
	]);

	return { volumes, vms };
};
