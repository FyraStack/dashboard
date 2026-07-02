import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { initAuth } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, params, request }) => {
	const redirectTo = `/accept-invitation/${params.invitationId}`;

	if (!locals.user || !locals.session) {
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
	}

	const auth = initAuth();
	const result = await auth.api.acceptInvitation({
		headers: request.headers,
		body: { invitationId: params.invitationId }
	});

	await auth.api.setActiveOrganization({
		headers: request.headers,
		body: { organizationId: result.member.organizationId }
	});

	throw redirect(303, `/projects/${result.member.organizationId}/servers`);
};
