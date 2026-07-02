import { createAuthClient } from 'better-auth/svelte';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { ac, organizationRoles } from '$lib/auth/organization-permissions';

export const authClient = createAuthClient({
	plugins: [
		adminClient(),
		twoFactorClient(),
		passkeyClient(),
		organizationClient({ ac, roles: organizationRoles })
	]
});
