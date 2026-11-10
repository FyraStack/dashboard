export const authBasePath = '/api/auth';

export const pendingPasskeyHintCookie = 'pending_passkey_2fa_hint';

export const passwordResetTokenCookie = 'password_reset_token';

export type VerificationMethod = 'email' | 'totp' | 'passkey';

export const verificationMethods = [
	'email',
	'totp',
	'passkey'
] as const satisfies readonly VerificationMethod[];

export const totpResetChoices = ['reset', 'disable'] as const;

export type TotpResetChoice = (typeof totpResetChoices)[number];

export const sessionCookieNames = [
	'better-auth.session_token',
	'__Secure-better-auth.session_token',
	'better-auth-session_token',
	'__Secure-better-auth-session_token'
] as const;

export const twoFactorDisableMethods = ['totp', 'backupCode'] as const;

export type TwoFactorDisableMethod = (typeof twoFactorDisableMethods)[number];
