import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	throw redirect(303, `/login/two-factor/totp${url.search}`);
};
