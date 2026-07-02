import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const redirectTo = url.searchParams.get('redirectTo') ?? '/';
	const verified = url.searchParams.get('verified') === '1';

	if (locals.user && locals.session) {
		throw redirect(303, redirectTo);
	}

	return { redirectTo, verified };
};
