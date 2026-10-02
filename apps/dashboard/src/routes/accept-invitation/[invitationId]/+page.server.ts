import { redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { initAuth } from '#lib/server/auth.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, request }) => {
	const redirectTo = `/accept-invitation/${params.invitationId}`;

	if (!(locals.user && locals.session)) {
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	const auth = initAuth();

	try {
		const invitation = await auth.api.getInvitation({
			headers: request.headers,
			query: { id: params.invitationId }
		});
		return {
			invitationId: params.invitationId,
			organizationName: invitation.organizationName,
			inviterEmail: invitation.inviterEmail,
			role: invitation.role,
			email: locals.user.email
		};
	} catch (err) {
		if (err instanceof APIError) {
			const code = (err.body as { code?: string } | undefined)?.code;
			const wrongAccount = code === 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION';
			return {
				error: wrongAccount
					? 'This invitation was sent to a different email address.'
					: 'This invitation is invalid, expired, or has already been used.',
				wrongAccount,
				email: locals.user.email,
				invitationId: params.invitationId
			};
		}
		throw err;
	}
};
