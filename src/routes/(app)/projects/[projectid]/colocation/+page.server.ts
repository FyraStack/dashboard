import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	redirect(302, `/projects/${params.projectid}/colocation/colo-001`);
};
