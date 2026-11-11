import { initAuth } from '#lib/server/auth.js';
import { context } from '#lib/server/context.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { parseVerificationCode, withStepUpAttemptLimit } from '#lib/server/verification-codes.js';

const TOTP_CODE_LENGTH = 6;

export async function verifyTotpCode(db: Database, userId: string, input: string) {
	const code = parseVerificationCode(input, TOTP_CODE_LENGTH);
	if (!code) {
		error(400, 'Enter the verification code from your authenticator app.');
	}

	return await withStepUpAttemptLimit(db, userId, () =>
		initAuth().api.verifyTOTP({
			headers: context().request.headers,
			body: { code, trustDevice: false },
			returnHeaders: true
		})
	);
}
