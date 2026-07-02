import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const pendingPasskeyHintCookie = 'pending_passkey_2fa_hint';

export const load: PageServerLoad = ({ cookies, url }) => {
	const pendingPasskeyHint = cookies.get(pendingPasskeyHintCookie);

	if (!pendingPasskeyHint) {
		throw redirect(303, '/login');
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';
	return { redirectTo, canUseTotp: pendingPasskeyHint === 'totp' };
};
