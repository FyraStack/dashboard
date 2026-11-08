import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { requiresTotpReset, resolvePendingTwoFactorUser } from '#lib/server/totp-reset.js';
import { maskEmail } from '#lib/totp-reset-flow.js';

export async function loadTotpLoginPage() {
	const db = initDrizzle();
	const pendingUser = await resolvePendingTwoFactorUser(
		context(),
		db,
		getRuntimeEnv().BETTER_AUTH_SECRET
	);
	const resetRequired = pendingUser ? await requiresTotpReset(db, pendingUser.id) : false;

	return {
		resetRequired,
		resetEmail: resetRequired && pendingUser ? maskEmail(pendingUser.email) : null
	};
}
