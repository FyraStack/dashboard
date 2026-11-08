import { redirect } from '@sveltejs/kit';
import type { AcceptInvitationPage } from 'stack-backend/types';
import { backend } from '#lib/server/backend.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => {
	if (!(locals.user && locals.session)) {
		const redirectTo = `/accept-invitation/${params.invitationId}`;
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	return backend<AcceptInvitationPage>((me) => me.invitationPage(params.invitationId));
};
