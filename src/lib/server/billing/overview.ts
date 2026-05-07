import { and, eq } from 'drizzle-orm';
import { ensureProjectCustomer } from './autumn';
import { meterProjectActiveResources, syncProjectUsage } from './metering';
import { initDrizzle } from '$lib/server/db';
import { billingMeters, projectBillingCustomers } from '$lib/server/db/schema';

export async function refreshProjectBilling(projectId: string) {
	await ensureProjectCustomer(projectId).catch((err) => {
		console.warn(`Failed to refresh Autumn customer for project ${projectId}`, err);
	});
	await meterProjectActiveResources(projectId);
	await syncProjectUsage(projectId);
}

export async function getProjectBillingOverview(projectId: string) {
	const db = initDrizzle();
	const customer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	const activeResourceRows = await db
		.select({
			id: billingMeters.id,
			resourceType: billingMeters.resourceType,
			featureId: billingMeters.featureId,
			units: billingMeters.units
		})
		.from(billingMeters)
		.where(
			and(
				eq(billingMeters.projectId, projectId),
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.active, true)
			)
		);

	return {
		customer: customer ? { autumnCustomerId: customer.autumnCustomerId } : null,
		statusLabel: customer ? 'Ready' : 'Not set up',
		planLabel: 'Project billing',
		lastUpdatedAt: Date.now(),
		activeResourceCount: activeResourceRows.length,
		activeResources: activeResourceRows.map((item) => ({
			id: item.id,
			label: item.featureId,
			resourceType: item.resourceType,
			quantity: Number(item.units),
			unit: 'active'
		}))
	};
}
