import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { projectId, servers } = await parent();

	if (!projectId) {
		return { hasServers: false };
	}

	if (servers.length > 0) {
		throw redirect(303, `/servers/${servers[0].id}`);
	}

	return { hasServers: false };
};
