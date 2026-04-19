import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { getRequestEvent } from '$app/server';
import { initDrizzle } from '$lib/server/db';
import { getRuntimeEnv } from '$lib/server/env';
import { ulid } from '$lib/server/id';

export function initAuth() {
	const env = getRuntimeEnv();

	return betterAuth({
		appName: 'Stack',
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(initDrizzle(), { provider: 'pg' }),
		advanced: {
			database: {
				generateId: () => ulid()
			}
		},

		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
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

		plugins: [twoFactor(), passkey(), sveltekitCookies(getRequestEvent)]
	});
}
