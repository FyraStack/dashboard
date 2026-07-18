import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { dashboardBrand } from '$lib/branding';

export const load: PageServerLoad = async ({ params }) => {
	throw redirect(303, `/projects/${params.projectid}/${dashboardBrand.defaultProjectPath}`);
};
