import { APIError } from 'better-auth/api';
import { initAuth } from '#lib/server/auth.js';
import { context } from '#lib/server/context.js';
import { error } from '#lib/server/http.js';

export interface LoadAcceptInvitationPageInput {
	invitationId: string;
}

export type AcceptInvitationPage =
	| {
			invitationId: string;
			organizationName: string;
			inviterEmail: string;
			role: string;
			email: string;
	  }
	| {
			error: string;
			wrongAccount: boolean;
			email: string;
			invitationId: string;
	  };

export async function loadAcceptInvitationPage(
	input: LoadAcceptInvitationPageInput
): Promise<AcceptInvitationPage> {
	const { locals, request } = context();
	if (!(locals.user && locals.session)) {
		error(401, 'Authentication required');
	}

	const auth = initAuth();

	try {
		const invitation = await auth.api.getInvitation({
			headers: request.headers,
			query: { id: input.invitationId }
		});
		return {
			invitationId: input.invitationId,
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
				invitationId: input.invitationId
			};
		}
		throw err;
	}
}
