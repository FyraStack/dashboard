import { ulid } from 'ulid';
import { verification } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { consumeVerification } from '#lib/server/verification-codes.js';

const BILLING_SETUP_TOKEN_TTL_MS = 60 * 60 * 1000;

export const BILLING_SETUP_QUERY_PARAM = 'billing_setup';

interface BillingSetupGrant {
	promoCode?: string;
	userId: string;
}

async function billingSetupIdentifier(projectId: string, token: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
	return `billing-setup:${projectId}:${hash.join('')}`;
}

export async function createBillingSetupToken(
	db: Database,
	projectId: string,
	grant: BillingSetupGrant
) {
	const token = crypto.randomUUID();
	await db.insert(verification).values({
		id: ulid(),
		identifier: await billingSetupIdentifier(projectId, token),
		value: JSON.stringify(grant),
		expiresAt: new Date(Date.now() + BILLING_SETUP_TOKEN_TTL_MS)
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
