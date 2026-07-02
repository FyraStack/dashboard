import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, gt } from 'drizzle-orm';
import { initAuth } from '$lib/server/auth';
import { initDrizzle } from '$lib/server/db';
import { user, verification } from '$lib/server/db/schema';
import { ulid } from '$lib/server/id';

const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

function pendingEmailChangeIdentifier(userId: string) {
	return `pending-email-change:${userId}`;
}

const emailChangeParams = type({ newEmail: 'string', callbackURL: 'string' });

export const getPendingEmailChange = query(async () => {
	const event = getRequestEvent();
	const sessionUser = event.locals.user;
	if (!sessionUser) error(401, 'Authentication required');

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
});

export const requestEmailChange = command(emailChangeParams, async (params) => {
	const event = getRequestEvent();
	const sessionUser = event.locals.user;
	if (!sessionUser) error(401, 'Authentication required');

	const newEmail = params.newEmail.trim().toLowerCase();
	if (!newEmail) error(400, 'Enter an email address.');
	if (newEmail === sessionUser.email.toLowerCase()) error(400, 'Email is the same.');

	const db = initDrizzle();
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, newEmail))
		.limit(1);

	if (existingUser) error(400, 'That email address is already in use.');

	const auth = initAuth();
	await auth.api.changeEmail({
		headers: event.request.headers,
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

	return { email: newEmail };
});
