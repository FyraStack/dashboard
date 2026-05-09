import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { autumn } from 'autumn-js/better-auth';
import { count } from 'drizzle-orm';
import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { ac, organizationRoles } from '$lib/auth/organization-permissions';
import { initDrizzle } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { getRuntimeEnv } from '$lib/server/env';
import { ulid } from '$lib/server/id';

export function initAuth() {
	const env = getRuntimeEnv();
	const db = initDrizzle();
	const requestOrigin = getRequestEvent().url.origin;

	return betterAuth({
		appName: 'Stack',
		baseURL: dev ? requestOrigin : env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg' }),
		advanced: {
			database: {
				generateId: () => ulid()
			}
		},
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
		databaseHooks: {
			user: {
				create: {
					before: async (newUser) => {
						const [row] = await db.select({ count: count() }).from(userTable);
						const isFirstUser = row.count === 0;
						return {
							data: { ...newUser, role: isFirstUser ? 'admin' : 'user', isAdmin: isFirstUser }
						};
					}
				}
			}
		},

		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
				...coreFields,
				role: 'user',
				banned: false,
				banReason: null,
				banExpires: null,
				...additionalFields,
				id
			}),
			sendResetPassword: async ({ user, url }) => {
				// TODO: replace with real email provider
				console.log(`[auth] Password reset for ${user.email}: ${url}`);
			}
		},

		emailVerification: {
			sendVerificationEmail: async ({ user, url }) => {
				// TODO: replace with real email provider
				console.log(`[auth] Verify email for ${user.email}: ${url}`);
			},
			sendOnSignUp: true
		},

		socialProviders: {
			...(env.GITHUB_CLIENT_ID && {
				github: {
					clientId: env.GITHUB_CLIENT_ID,
					clientSecret: env.GITHUB_CLIENT_SECRET!
				}
			}),
			...(env.GOOGLE_CLIENT_ID && {
				google: {
					clientId: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET!
				}
			})
		},

		plugins: [
			admin({ defaultRole: 'user' }),
			twoFactor(),
			passkey(),
			organization({
				ac,
				roles: organizationRoles,
				sendInvitationEmail: async ({ email, id, organization }) => {
					const url = `${env.ORIGIN}/accept-invitation/${id}`;
					console.log(`[auth] Invite ${email} to ${organization.name}: ${url}`);
				}
			}),
			autumn({ customerScope: 'organization', secretKey: env.AUTUMN_SECRET }),
			sveltekitCookies(getRequestEvent)
		]
	});
}
