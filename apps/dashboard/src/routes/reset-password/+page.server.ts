import { passwordResetTokenCookie } from 'stack-shared/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, cookies }) => {
	const token = cookies.get(passwordResetTokenCookie) ?? null;
	const invalidToken = !token || url.searchParams.get('error') === 'INVALID_TOKEN';

	return { token, invalidToken };
};
