import { redirect } from '@sveltejs/kit';
import { initDrizzle } from '#lib/server/db/index.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { requiresTotpReset, resolvePendingTwoFactorUser } from '#lib/server/totp-reset.js';
import { maskEmail } from '#lib/totp-reset-flow.js';
import type { PageServerLoad } from './$types';

const pendingPasskeyHintCookie = 'pending_passkey_2fa_hint';

export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	if (cookies.get(pendingPasskeyHintCookie) === 'passkey') {
		throw redirect(303, `/login/two-factor/passkey${url.search}`);
	}

	const redirectTo = url.searchParams.get('redirectTo') ?? '/';

	const db = initDrizzle();
	const pendingUser = await resolvePendingTwoFactorUser(
		event,
		db,
		getRuntimeEnv().BETTER_AUTH_SECRET
	);
	const resetRequired = pendingUser ? await requiresTotpReset(db, pendingUser.id) : false;

	return {
		redirectTo,
		resetRequired,
		resetEmail: resetRequired && pendingUser ? maskEmail(pendingUser.email) : null
	};
};
