import { waitUntil } from 'cloudflare:workers';
import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { deleteSessionCookie, expireCookie } from 'better-auth/cookies';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { and, count, eq } from 'drizzle-orm';
import { ac, organizationRoles } from 'stack-shared/access-control';
import { pendingPasskeyHintCookie } from 'stack-shared/auth';
import { resetPasswordPath } from 'stack-shared/routes';
import { ulid } from 'ulid';
import EmailChangeConfirmationEmail from '#lib/emails/email-change-confirmation.svelte';
import OrganizationInvitationEmail from '#lib/emails/organization-invitation.svelte';
import ResetPasswordEmail from '#lib/emails/reset-password.svelte';
import VerifyEmail from '#lib/emails/verify-email.svelte';
import { userAdditionalFields } from '#lib/server/auth-user-fields.js';
import { context as requestContext } from '#lib/server/context.js';
import { member, user as userTable } from '#lib/server/db/auth.schema.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { sendSecurityAlertEmail } from '#lib/server/email-notifications.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import {
	clearVerification,
	recordPasskeyProofs,
	verificationIdentifiers
} from '#lib/server/verification-codes.js';

const PENDING_PASSKEY_COOKIE = 'pending_passkey_2fa';
const PENDING_PASSKEY_MAX_AGE = 600;
export const VERIFIED_2FA_DISABLE_HEADER = 'x-fyra-verified-2fa-disable';
const TOTP_SECRET_KEY_VERSION = 1;

interface PasskeyRecord {
	userId: string;
}

function sendAuthEmail(email: Promise<void>): Promise<void> {
	waitUntil(email);
	return Promise.resolve();
}

function securityAlertDetails() {
	const { headers } = requestContext().request;
	const ipAddress =
		headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0];
	const userAgent = headers.get('user-agent');
	const details = [
		ipAddress ? `IP: ${ipAddress.trim()}` : null,
		userAgent ? `Device: ${userAgent}` : null
	]
		.filter(Boolean)
		.join(' | ');

	return details || null;
}

function sendSignInSecurityAlert(user: { email: string; name?: string | null }, baseURL: string) {
	return sendAuthEmail(
		sendSecurityAlertEmail({
			to: user.email,
			userName: user.name,
			alertType: 'New sign-in',
			message: 'A new sign-in to your Stack account was completed.',
			details: securityAlertDetails(),
			actionUrl: baseURL
		})
	);
}

const lazyDb = new Proxy({} as Database, {
	get(_target, prop) {
		const db = initDrizzle();
		const value = Reflect.get(db, prop, db);
		return typeof value === 'function' ? value.bind(db) : value;
	},
	has(_target, prop) {
		return prop in initDrizzle();
	}
});

async function resyncOwnedProjectBilling(userId: string) {
	const { updateProjectCustomer } = await import('#lib/server/billing/autumn.js');
	const db = initDrizzle();
	const owned = await db
		.select({ organizationId: member.organizationId })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.role, 'owner')));

	for (const { organizationId } of owned) {
		// biome-ignore lint/performance/noAwaitInLoops: Autumn customer updates are sent one at a time to stay within its rate limits
		await updateProjectCustomer(organizationId).catch((err) => {
			console.warn(`Failed to sync Autumn customer email for project ${organizationId}`, err);
		});
	}
}

function buildAuth() {
	const env = getRuntimeEnv();
	const db = lazyDb;
	const baseURL = env.ORIGIN;

	return betterAuth({
		appName: 'Stack',
		baseURL,
		secret: env.BETTER_AUTH_SECRET,
		secrets: [
			{
				version: TOTP_SECRET_KEY_VERSION,
				value: env.BETTER_AUTH_SECRET
			}
		],
		database: drizzleAdapter(db, { provider: 'pg' }),
		advanced: { database: { generateId: () => ulid() } },
		session: { cookieCache: { enabled: true, maxAge: 300 } },
		user: {
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
					sendAuthEmail(
						sendRenderedEmail({
							component: EmailChangeConfirmationEmail,
							props: { userName: user.name, newEmail, confirmationUrl: url },
							subject: 'Confirm your Stack email change',
							to: user.email
						})
					)
			},
			additionalFields: userAdditionalFields
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
					},
					after: (createdUser) => {
						captureServerEvent(
							'user_signed_up',
							{},
							{
								distinctId: createdUser.id,
								set: { email: createdUser.email, name: createdUser.name }
							}
						);
						return Promise.resolve();
					}
				}
			},
			session: {
				create: {
					after: (createdSession) => {
						captureServerEvent('user_signed_in', {}, { distinctId: createdSession.userId });
						return Promise.resolve();
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
			sendResetPassword: ({ user, token }) =>
				sendAuthEmail(
					sendRenderedEmail({
						component: ResetPasswordEmail,
						props: {
							userName: user.name,
							resetUrl: `${baseURL}${resetPasswordPath}?token=${encodeURIComponent(token)}`
						},
						subject: 'Reset your Stack password',
						to: user.email
					})
				)
		},

		emailVerification: {
			sendVerificationEmail: ({ user, url }) =>
				sendAuthEmail(
					sendRenderedEmail({
						component: VerifyEmail,
						props: { userName: user.name, verificationUrl: url },
						subject: 'Verify your Stack email',
						to: user.email
					})
				),
			afterEmailVerification: async (user) => {
				await clearVerification(
					db,
					verificationIdentifiers.pendingEmailChange(user.id),
					user.email.toLowerCase()
				);
				await resyncOwnedProjectBilling(user.id);
			},
			sendOnSignUp: true
		},

		socialProviders: {
			...(env.GITHUB_CLIENT_ID &&
				env.GITHUB_CLIENT_SECRET && {
					github: {
						clientId: env.GITHUB_CLIENT_ID,
						clientSecret: env.GITHUB_CLIENT_SECRET
					}
				})
		},

		plugins: [
			admin({
				defaultRole: 'user',
				bannedUserMessage: 'Please contact support: support@fyrastack.com'
			}),
			{
				id: 'verified-two-factor-disable',
				hooks: {
					before: [
						{
							matcher: (context) => context.path === '/two-factor/disable',
							handler: createAuthMiddleware((ctx) => {
								if (ctx.headers?.get(VERIFIED_2FA_DISABLE_HEADER) === env.BETTER_AUTH_SECRET) {
									return Promise.resolve();
								}

								return Promise.reject(
									APIError.from('FORBIDDEN', {
										code: 'TWO_FACTOR_VERIFICATION_REQUIRED',
										message:
											'Verify with an authenticator app or backup code before disabling two-factor authentication.'
									})
								);
							})
						}
					]
				}
			},
			{
				id: 'passkey-second-factor',
				hooks: {
					after: [
						{
							matcher: (context) => context.path === '/sign-in/email',
							handler: createAuthMiddleware(async (ctx) => {
								const data = ctx.context.newSession;
								if (!data) {
									return;
								}

								const userPasskeys = await ctx.context.adapter.findMany({
									model: 'passkey',
									where: [{ field: 'userId', value: data.user.id }]
								});

								if (userPasskeys.length === 0) {
									if (!data.user.twoFactorEnabled) {
										await sendSignInSecurityAlert(data.user, baseURL);
									}
									return;
								}

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
									pendingPasskeyHintCookie,
									data.user.twoFactorEnabled ? 'totp' : 'passkey',
									{
										httpOnly: true,
										maxAge: PENDING_PASSKEY_MAX_AGE,
										path: '/',
										sameSite: 'lax',
										secure: !import.meta.env.DEV
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

						const verifiedPasskey = (await ctx.context.adapter.findOne({
							model: 'passkey',
							where: [{ field: 'credentialID', value: clientData.id }]
						})) as PasskeyRecord | null;

						if (!verifiedPasskey) {
							return;
						}

						if (!pendingUserId) {
							const sessionToken = await ctx.getSignedCookie(
								ctx.context.authCookies.sessionToken.name,
								ctx.context.secret
							);
							if (!sessionToken) {
								return;
							}

							const currentSession = await ctx.context.internalAdapter.findSession(sessionToken);
							if (currentSession?.user.id !== verifiedPasskey.userId) {
								throw APIError.from('UNAUTHORIZED', {
									code: 'INVALID_PASSKEY_PASSWORD_CHANGE',
									message: 'Use a passkey registered to this account.'
								});
							}

							await recordPasskeyProofs(db, verifiedPasskey.userId, clientData.id);
							return;
						}

						if (verifiedPasskey.userId !== pendingUserId) {
							throw APIError.from('UNAUTHORIZED', {
								code: 'INVALID_PASSKEY_SECOND_FACTOR',
								message: 'Use a passkey registered to this account.'
							});
						}

						expireCookie(ctx as Parameters<typeof expireCookie>[0], pendingPasskeyCookie);
						ctx.setCookie(pendingPasskeyHintCookie, '', {
							httpOnly: true,
							maxAge: 0,
							path: '/',
							sameSite: 'lax',
							secure: !import.meta.env.DEV
						});

						const verifiedUser = await db.query.user.findFirst({
							where: eq(userTable.id, pendingUserId)
						});

						if (verifiedUser) {
							await sendSignInSecurityAlert(verifiedUser, baseURL);
						}
					}
				}
			}),
			organization({
				ac,
				roles: organizationRoles,
				sendInvitationEmail: ({ email, id, organization: invitedOrganization }) => {
					const invitationUrl = `${baseURL}/accept-invitation/${id}`;
					return sendAuthEmail(
						sendRenderedEmail({
							component: OrganizationInvitationEmail,
							props: { organizationName: invitedOrganization.name, invitationUrl },
							subject: `You're invited to join ${invitedOrganization.name} on Stack`,
							to: email
						})
					);
				}
			})
		]
	});
}

let authInstance: ReturnType<typeof buildAuth> | null = null;

export function initAuth() {
	authInstance ??= buildAuth();
	return authInstance;
}
