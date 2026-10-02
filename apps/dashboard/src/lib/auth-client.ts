import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/svelte';
import { ac, organizationRoles } from '#lib/auth/organization-permissions.js';

export const authClient = createAuthClient({
	plugins: [
		adminClient(),
		twoFactorClient(),
		passkeyClient(),
		organizationClient({ ac, roles: organizationRoles })
	]
});
