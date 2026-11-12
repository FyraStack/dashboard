import type { VerificationMethod } from 'stack-shared/auth';

export function describeDeletionVerification(
	method: VerificationMethod,
	target: string,
	codeEmail: string
) {
	switch (method) {
		case 'passkey':
			return `Use your registered passkey to confirm permanently deleting ${target}.`;
		case 'totp':
			return `Enter a code from your authenticator app to confirm permanently deleting ${target}.`;
		default:
			return `Enter the code sent to ${codeEmail} to confirm permanently deleting ${target}.`;
	}
}
