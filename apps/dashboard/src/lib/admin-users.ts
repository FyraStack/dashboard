import type { AdminUser } from '#lib/remote/admin-users.remote.js';

export function hasAnyTwoFactor(user: Pick<AdminUser, 'passkeyCount' | 'twoFactorEnabled'>) {
	return user.twoFactorEnabled || user.passkeyCount > 0;
}

export function ownerOptions(rows: { ownerEmail: string | null; ownerName: string | null }[]) {
	const namesByEmail = new Map<string, string>();
	for (const { ownerEmail, ownerName } of rows) {
		if (ownerEmail) {
			namesByEmail.set(ownerEmail, ownerName ?? ownerEmail);
		}
	}
	return [...namesByEmail]
		.map(([email, name]) => ({ email, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
}
