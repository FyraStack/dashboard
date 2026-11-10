import { sha256Hex } from 'stack-shared/hash';
import type { Database } from '#lib/server/db/index.js';
import {
	consumeVerification,
	storeVerification,
	verificationIdentifiers
} from '#lib/server/verification-codes.js';

const BILLING_SETUP_TOKEN_TTL_MS = 60 * 60 * 1000;

interface BillingSetupGrant {
	promoCode?: string;
	userId: string;
}

async function billingSetupIdentifier(projectId: string, token: string) {
	return verificationIdentifiers.billingSetup(projectId, await sha256Hex(token));
}

export async function createBillingSetupToken(
	db: Database,
	projectId: string,
	grant: BillingSetupGrant
) {
	const token = crypto.randomUUID();
	await storeVerification(db, {
		identifier: await billingSetupIdentifier(projectId, token),
		value: JSON.stringify(grant),
		ttlMs: BILLING_SETUP_TOKEN_TTL_MS
	});
	return token;
}

export async function consumeBillingSetupToken(
	db: Database,
	projectId: string,
	userId: string,
	token: string
): Promise<BillingSetupGrant | null> {
	const consumed = await consumeVerification(db, await billingSetupIdentifier(projectId, token));
	if (!consumed) {
		return null;
	}

	const grant = JSON.parse(consumed.value) as BillingSetupGrant;
	return grant.userId === userId ? grant : null;
}
