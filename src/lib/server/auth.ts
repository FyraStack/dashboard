import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
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

const PENDING_PASSKEY_COOKIE = 'pending_passkey_2fa';
const PENDING_PASSKEY_HINT_COOKIE = 'pending_passkey_2fa_hint';
const PENDING_PASSKEY_MAX_AGE = 600;

type PasskeyRecord = {
	userId: string;
};

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
			{
				id: 'passkey-second-factor',
				hooks: {
					after: [
						{
							matcher: (context) => context.path === '/sign-in/email',
							handler: createAuthMiddleware(async (ctx) => {
								const data = ctx.context.newSession;
								if (!data) return;

								const userPasskeys = await ctx.context.adapter.findMany({
									model: 'passkey',
									where: [{ field: 'userId', value: data.user.id }]
								});

								if (userPasskeys.length === 0) return;

								deleteSessionCookie(ctx, true);
								await ctx.context.internalAdapter.deleteSession(data.session.token);

								const pendingPasskeyCookie = ctx.context.createAuthCookie(PENDING_PASSKEY_COOKIE, {
									maxAge: PENDING_PASSKEY_MAX_AGE
								});

								await ctx.setSignedCookie(
									pendingPasskeyCookie.name,
									data.user.id,
									ctx.context.secret,
									pendingPasskeyCookie.attributes
								);
								ctx.setCookie(
									PENDING_PASSKEY_HINT_COOKIE,
									data.user.twoFactorEnabled ? 'totp' : 'passkey',
									{
										httpOnly: true,
										maxAge: PENDING_PASSKEY_MAX_AGE,
										path: '/',
										sameSite: 'lax',
										secure: !dev
									}
								);

								return ctx.json({
									twoFactorRedirect: true,
									twoFactorMethods: data.user.twoFactorEnabled ? ['passkey', 'totp'] : ['passkey']
								});
							})
						}
					]
				}
			},
			twoFactor(),
			passkey({
				authentication: {
					afterVerification: async ({ ctx, clientData }) => {
						const pendingPasskeyCookie = ctx.context.createAuthCookie(PENDING_PASSKEY_COOKIE, {
							maxAge: PENDING_PASSKEY_MAX_AGE
						});
						const pendingUserId = await ctx.getSignedCookie(
							pendingPasskeyCookie.name,
							ctx.context.secret
						);

						if (!pendingUserId) return;

						const verifiedPasskey = (await ctx.context.adapter.findOne({
							model: 'passkey',
							where: [{ field: 'credentialID', value: clientData.id }]
						})) as PasskeyRecord | null;

						if (!verifiedPasskey || verifiedPasskey.userId !== pendingUserId) {
							throw APIError.from('UNAUTHORIZED', {
								code: 'INVALID_PASSKEY_SECOND_FACTOR',
								message: 'Use a passkey registered to this account.'
							});
						}

						expireCookie(ctx, pendingPasskeyCookie);
						ctx.setCookie(PENDING_PASSKEY_HINT_COOKIE, '', {
							httpOnly: true,
							maxAge: 0,
							path: '/',
							sameSite: 'lax',
							secure: !dev
						});
					}
				}
			}),
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
