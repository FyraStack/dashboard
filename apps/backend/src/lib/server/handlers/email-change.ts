import { and, eq, gt } from 'drizzle-orm';
import { ulid } from 'ulid';
import { initAuth } from '#lib/server/auth.js';
import { context } from '#lib/server/context.js';
import { verification } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';

const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

export interface RequestEmailChangeInput {
	callbackURL: string;
	newEmail: string;
}

function pendingEmailChangeIdentifier(userId: string) {
	return `pending-email-change:${userId}`;
}

export async function getPendingEmailChange() {
	const sessionUser = context().locals.user;
	if (!sessionUser) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	const [record] = await db
		.select({ email: verification.value })
		.from(verification)
		.where(
			and(
				eq(verification.identifier, pendingEmailChangeIdentifier(sessionUser.id)),
				gt(verification.expiresAt, new Date())
			)
		)
		.limit(1);

	return record?.email ?? null;
}

export async function requestEmailChange(params: RequestEmailChangeInput) {
	const { locals, request } = context();
	const sessionUser = locals.user;
	if (!sessionUser) {
		error(401, 'Authentication required');
	}

	const newEmail = params.newEmail.trim().toLowerCase();
	if (!newEmail) {
		error(400, 'Enter an email address.');
	}
	if (newEmail === sessionUser.email.toLowerCase()) {
		error(400, 'Email is the same.');
	}

	const db = initDrizzle();
	const auth = initAuth();
	await auth.api.changeEmail({
		headers: request.headers,
		body: { newEmail, callbackURL: params.callbackURL }
	});

	const identifier = pendingEmailChangeIdentifier(sessionUser.id);
	await db.delete(verification).where(eq(verification.identifier, identifier));
	await db.insert(verification).values({
		id: ulid(),
		identifier,
		value: newEmail,
		expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS)
	});

	captureServerEvent('email_change_requested');

	return { email: newEmail };
}
