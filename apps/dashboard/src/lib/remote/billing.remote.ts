import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command } from '$app/server';

const projectParams = type({ projectId: 'string' });
const setupParams = type({ projectId: 'string', returnTo: 'string?', discountCode: 'string?' });
const purchaseCreditsParams = type({
	projectId: 'string',
	credits: 'number.integer > 0',
	idempotencyKey: '0 < string <= 128'
});

export const openBillingPortal = command(projectParams, ({ projectId }) =>
	backend((me) => me.project(projectId).openBillingPortal())
);

export const purchaseCredits = command(
	purchaseCreditsParams,
	({ credits, idempotencyKey, projectId }) =>
		backend((me) => me.project(projectId).purchaseCredits({ credits, idempotencyKey }))
);

export const setupProjectBillingPayment = command(
	setupParams,
	({ discountCode, projectId, returnTo }) =>
		backend((me) => me.project(projectId).setupBillingPayment({ discountCode, returnTo }))
);
