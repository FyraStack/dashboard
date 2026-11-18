import { dependencies } from '#lib/dependencies.js';
import { requireFeature } from '#lib/feature-gate.js';
import { getAdminTicket } from '#lib/remote/admin-support.remote.js';
import { renderMarkdown } from '#lib/server/markdown.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, params, parent }) => {
	depends(dependencies.admin.tickets);
	await requireFeature(parent, 'support');

	const { messages, ...ticket } = await getAdminTicket({ ticketId: params.ticketid });

	return {
		ticket,
		messages: messages.map(({ body, ...message }) => ({
			...message,
			html: renderMarkdown(body)
		}))
	};
};
