import { type } from 'arktype';
import {
	accessibilityFixtureBillingOverview,
	accessibilityFixtureEnabled
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

const projectParams = type({ projectId: 'string' });
const setupParams = type({ projectId: 'string', returnTo: 'string?', discountCode: 'string?' });
const purchaseCreditsParams = type({
	projectId: 'string',
	credits: 'number.integer > 0',
	idempotencyKey: '0 < string <= 128'
});

export const getProjectBilling = query(projectParams, async ({ projectId }) => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureBillingOverview;
	}

	return await backend((me) => me.project(projectId).billing());
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
