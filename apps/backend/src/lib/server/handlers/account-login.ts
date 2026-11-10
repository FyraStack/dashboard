import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { requiresTotpReset, resolvePendingTwoFactorUser } from '#lib/server/totp-reset.js';

function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) {
		return email;
	}
	const local = email.slice(0, at);
	const domain = email.slice(at);
	const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
	return `${visible}${'•'.repeat(Math.max(local.length - visible.length, 3))}${domain}`;
}

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
