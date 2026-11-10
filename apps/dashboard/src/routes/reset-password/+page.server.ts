import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, cookies }) => {
	const token = cookies.get('password_reset_token') ?? null;
	const invalidToken = !token || url.searchParams.get('error') === 'INVALID_TOKEN';

	return { token, invalidToken };
};
