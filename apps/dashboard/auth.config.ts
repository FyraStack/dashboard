/**
 * CLI-only config consumed by `better-auth generate`.
 * Mirrors the plugin list in src/lib/server/auth.ts without SvelteKit
 * runtime deps ($app/*, $env/*) that jiti cannot resolve.
 *
 * If you add or remove plugins in auth.ts, update this file to match.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { autumn } from 'autumn-js/better-auth';
import { ac, organizationRoles } from './src/lib/auth/organization-permissions';

// Drizzle doesn't open a connection until the first query, so this is
// safe for CLI-only usage where no queries are ever executed.
const db = drizzle('postgresql://user:pass@localhost:5432/placeholder');

export default betterAuth({
	database: drizzleAdapter(db, { provider: 'pg' }),
	user: {
		additionalFields: {
			isAdmin: {
				type: 'boolean',
				input: false,
				required: true,
				defaultValue: false
			}
		}
	},
	emailAndPassword: { enabled: true },
	plugins: [
		admin({ defaultRole: 'user' }),
		twoFactor(),
		passkey(),
		organization({ ac, roles: organizationRoles }),
		autumn({ customerScope: 'organization' })
	]
});
