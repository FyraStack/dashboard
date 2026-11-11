import { eq } from 'drizzle-orm';
import type { VerificationMethod } from 'stack-shared/auth';
import { passkey, twoFactor } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { verifyTotpCode } from '#lib/server/totp-verification.js';
import {
	consumeProof,
	consumeVerificationCode,
	issueVerificationCode,
	storeVerification,
	VERIFICATION_PROOF_TTL_MS,
	verificationIdentifiers,
	withStepUpAttemptLimit
} from '#lib/server/verification-codes.js';

async function getAdminVerificationMethod(
	db: Database,
	adminUserId: string
): Promise<VerificationMethod> {
	const [registeredPasskey] = await db
		.select({ id: passkey.id })
		.from(passkey)
		.where(eq(passkey.userId, adminUserId))
		.limit(1);

	if (registeredPasskey) {
		return 'passkey';
	}

	const [registeredTotp] = await db
		.select({ id: twoFactor.id })
		.from(twoFactor)
		.where(eq(twoFactor.userId, adminUserId))
		.limit(1);

	return registeredTotp ? 'totp' : 'email';
}

export async function beginAdminVerification(
	db: Database,
	adminUserId: string,
	targetId: string
): Promise<{ method: VerificationMethod; code: string | null }> {
	const method = await getAdminVerificationMethod(db, adminUserId);

	if (method === 'passkey') {
		await storeVerification(db, {
			identifier: verificationIdentifiers.adminActionIntent(adminUserId),
			value: targetId,
			ttlMs: VERIFICATION_PROOF_TTL_MS
		});
		return { method, code: null };
	}

	if (method === 'email') {
		const code = await issueVerificationCode(
			db,
			verificationIdentifiers.adminActionEmail(adminUserId, targetId)
		);
		return { method, code };
	}

	return { method, code: null };
}

export async function consumeAdminVerification(
	db: Database,
	adminUserId: string,
	targetId: string,
	method: VerificationMethod,
	code: string | undefined
) {
	const required = await getAdminVerificationMethod(db, adminUserId);
	if (method !== required) {
		error(400, 'Use the required verification method for this account.');
	}

	if (required === 'passkey') {
		await consumeProof(
			db,
			verificationIdentifiers.adminActionPasskey(adminUserId, targetId),
			'Verify with your passkey before performing this action.'
		);
		return;
	}

	if (required === 'totp') {
		await verifyTotpCode(db, adminUserId, code ?? '');
		return;
	}

	await withStepUpAttemptLimit(db, adminUserId, () =>
		consumeVerificationCode(
			db,
			verificationIdentifiers.adminActionEmail(adminUserId, targetId),
			code ?? ''
		)
	);
}
