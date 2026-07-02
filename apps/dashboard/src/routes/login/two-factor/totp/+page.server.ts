import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const pendingPasskeyHintCookie = 'pending_passkey_2fa_hint';

export const load: PageServerLoad = ({ cookies, url }) => {
	if (cookies.get(pendingPasskeyHintCookie) === 'passkey') {
		throw redirect(303, `/login/two-factor/passkey${url.search}`);
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';
	return { redirectTo };
};
