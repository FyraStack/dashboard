import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
	redirectTo: url.searchParams.get('redirectTo') ?? '/',
	verified: url.searchParams.get('verified') === '1'
});
