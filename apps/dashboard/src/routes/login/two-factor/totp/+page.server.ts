import { redirect } from '@sveltejs/kit';
import { pendingPasskeyHintCookie } from 'stack-shared/auth';
import { backend } from '#lib/server/backend.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	if (cookies.get(pendingPasskeyHintCookie) === 'passkey') {
		throw redirect(303, `/login/two-factor/passkey${url.search}`);
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';

	const { resetRequired, resetEmail } = await backend((me) => me.twoFactorReset().page());

	return { redirectTo, resetRequired, resetEmail };
};
