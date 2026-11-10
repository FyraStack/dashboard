import { initAuth } from '#lib/server/auth.js';
import { requireUser } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import {
	findVerification,
	storeVerification,
	verificationIdentifiers
} from '#lib/server/verification-codes.js';

const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

export interface RequestEmailChangeInput {
	callbackURL: string;
	newEmail: string;
}

export async function getPendingEmailChange() {
	const { db, user: sessionUser } = requireUser();

	const pending = await findVerification(
		db,
		verificationIdentifiers.pendingEmailChange(sessionUser.id)
	);

	return pending?.value ?? null;
}

export async function requestEmailChange(params: RequestEmailChangeInput) {
	const { db, user: sessionUser } = requireUser();

	const newEmail = params.newEmail.trim().toLowerCase();
	if (!newEmail) {
		error(400, 'Enter an email address.');
	}
	if (newEmail === sessionUser.email.toLowerCase()) {
		error(400, 'Email is the same.');
	}

	await initAuth().api.changeEmail({
		headers: context().request.headers,
		body: { newEmail, callbackURL: params.callbackURL }
	});

	await storeVerification(db, {
		identifier: verificationIdentifiers.pendingEmailChange(sessionUser.id),
		value: newEmail,
		ttlMs: EMAIL_CHANGE_TTL_MS
	});

	captureServerEvent('email_change_requested');

	return { email: newEmail };
}
