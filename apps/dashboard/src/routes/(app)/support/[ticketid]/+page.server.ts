import { dependencies } from '#lib/dependencies.js';
import { requireFeature } from '#lib/feature-gate.js';
import { getTicket } from '#lib/remote/support.remote.js';
import { renderMarkdown } from '#lib/server/markdown.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, params, parent }) => {
	depends(dependencies.support.tickets);
	await requireFeature(parent, 'support');

	const { messages, ...ticket } = await getTicket({ ticketId: params.ticketid });

	return {
		ticket,
		messages: messages.map(({ body, ...message }) => ({
			...message,
			html: renderMarkdown(body)
		}))
	};
};
