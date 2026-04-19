import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { user } = await parent();

	if (!user) {
		throw redirect(303, '/login');
	}

	const next = new URL('/servers', url);
	const projectId = url.searchParams.get('projectId');
	if (projectId) {
		next.searchParams.set('projectId', projectId);
	}

	throw redirect(303, `${next.pathname}${next.search}`);
};
