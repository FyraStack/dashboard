import { passkey } from '@better-auth/passkey';
import { autumn } from 'autumn-js/better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ac, organizationRoles } from 'stack-shared/access-control';
import { userAdditionalFields } from './src/lib/server/auth-user-fields.ts';

// Drizzle doesn't open a connection until the first query, so this is
// safe for CLI-only usage where no queries are ever executed.
const db = drizzle('postgresql://user:pass@localhost:5432/placeholder');

export default betterAuth({
	database: drizzleAdapter(db, { provider: 'pg' }),
	user: { additionalFields: userAdditionalFields },
	emailAndPassword: { enabled: true },
	plugins: [
		admin({ defaultRole: 'user' }),
		twoFactor(),
		passkey(),
		organization({
			ac,
			roles: organizationRoles,
			schema: {
				organization: {
					additionalFields: {
						billingExempt: {
							type: 'boolean',
							input: false,
							required: true,
							defaultValue: false
						},
						disabled: {
							type: 'boolean',
							input: false,
							required: true,
							defaultValue: false
						},
						deletedAt: {
							type: 'number',
							bigint: true,
							input: false,
							required: false
						}
					}
				}
			}
		}),
		autumn({ customerScope: 'organization' })
	]
});
