import { redirect } from '@sveltejs/kit';
import { pendingPasskeyHintCookie } from 'stack-shared/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies, url }) => {
	const pendingPasskeyHint = cookies.get(pendingPasskeyHintCookie);

	if (!pendingPasskeyHint) {
		throw redirect(303, '/login');
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';
	return { redirectTo, canUseTotp: pendingPasskeyHint === 'totp' };
};
