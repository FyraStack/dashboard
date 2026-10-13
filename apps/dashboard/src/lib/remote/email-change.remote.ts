import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, gt, sql } from 'drizzle-orm';
import { initAuth } from '#lib/server/auth.js';
import { user, verification } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { ulid } from '#lib/server/id.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { command, getRequestEvent, query } from '$app/server';

const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_RESEND_INTERVAL_MS = 60 * 1000;

function pendingEmailChangeIdentifier(userId: string) {
	return `pending-email-change:${userId}`;
}

const emailChangeParams = type({ newEmail: 'string', callbackURL: 'string' });

export const getPendingEmailChange = query(async () => {
	const event = getRequestEvent();
	const sessionUser = event.locals.user;
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
});

export const requestEmailChange = command(emailChangeParams, async (params) => {
	const event = getRequestEvent();
	const sessionUser = event.locals.user;
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
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, newEmail))
		.limit(1);

	if (existingUser) {
		error(400, 'That email address is already in use.');
	}

	const identifier = pendingEmailChangeIdentifier(sessionUser.id);
	const id = ulid();
	const claimed = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identifier}))`);
		const now = new Date();
		const [existing] = await tx
			.select({ email: verification.value, createdAt: verification.createdAt })
			.from(verification)
			.where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
			.limit(1);
		if (
			existing?.email === newEmail &&
			now.getTime() - existing.createdAt.getTime() < EMAIL_CHANGE_RESEND_INTERVAL_MS
		) {
			return false;
		}

		await tx.delete(verification).where(eq(verification.identifier, identifier));
		await tx.insert(verification).values({
			id,
			identifier,
			value: newEmail,
			createdAt: now,
			expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS)
		});
		return true;
	});

	if (!claimed) {
		return { email: newEmail, sent: false };
	}

	const auth = initAuth();
	try {
		await auth.api.changeEmail({
			headers: event.request.headers,
			body: { newEmail, callbackURL: params.callbackURL }
		});
	} catch (err) {
		await db.delete(verification).where(eq(verification.id, id));
		throw err;
	}

	captureServerEvent('email_change_requested');

	return { email: newEmail, sent: true };
});
