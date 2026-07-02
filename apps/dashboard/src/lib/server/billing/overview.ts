import { and, eq, inArray, sum } from 'drizzle-orm';
import {
	ensureProjectCustomer,
	getProjectBillingState,
	invalidateProjectBillingState
} from './autumn';
import { initDrizzle } from '$lib/server/db';
import { billingMeters, billingUsageEvents, vmTypes } from '$lib/server/db/schema';

function statusLabel(status: Awaited<ReturnType<typeof getProjectBillingState>>['status']) {
	if (status === 'active') return 'Ready';
	if (status === 'past_due') return 'Past due';
	if (status === 'failed') return 'Needs attention';
	if (status === 'payment_required') return 'Payment method required';
	if (status === 'provider_unavailable') return 'Billing temporarily unavailable';
	return 'Not set up';
}

export async function refreshProjectBilling(projectId: string) {
	await ensureProjectCustomer(projectId).catch((err) => {
		console.warn(`Failed to refresh Autumn customer for project ${projectId}`, err);
	});
	invalidateProjectBillingState(projectId);
}

export async function getProjectBillingOverview(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	const billingState = await getProjectBillingState(projectId);

	const activeMeters = await db
		.select({
			resourceId: billingMeters.resourceId,
			featureId: billingMeters.featureId,
			units: billingMeters.units,
			lastMeteredAt: billingMeters.lastMeteredAt
		})
		.from(billingMeters)
		.where(
			and(
				eq(billingMeters.projectId, projectId),
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.active, true)
			)
		);

	const activeResourceIds = activeMeters.map((meter) => meter.resourceId);

	const recordedRows = activeResourceIds.length
		? await db
				.select({ featureId: billingUsageEvents.featureId, hours: sum(billingUsageEvents.quantity) })
				.from(billingUsageEvents)
				.where(
					and(
						eq(billingUsageEvents.projectId, projectId),
						inArray(billingUsageEvents.resourceId, activeResourceIds)
					)
				)
				.groupBy(billingUsageEvents.featureId)
		: [];

	const vmTypeRows = await db
		.select({ featureId: vmTypes.autumnFeatureId, name: vmTypes.name, rate: vmTypes.rate })
		.from(vmTypes);

	const recordedByFeature = new Map(recordedRows.map((row) => [row.featureId, Number(row.hours ?? 0)]));
	const vmTypeByFeature = new Map<string, { name: string; rate: string }>();
	for (const row of vmTypeRows) {
		if (row.featureId) vmTypeByFeature.set(row.featureId, { name: row.name, rate: row.rate });
	}

	const groups = new Map<string, { count: number; liveHours: number }>();
	for (const meter of activeMeters) {
		const group = groups.get(meter.featureId) ?? { count: 0, liveHours: 0 };
		group.count += 1;
		group.liveHours += Math.max(0, (now - meter.lastMeteredAt) / 3_600_000) * Number(meter.units);
		groups.set(meter.featureId, group);
	}

	const activeResources = [...groups.entries()].map(([featureId, group]) => {
		const vmType = vmTypeByFeature.get(featureId);
		const hours = group.liveHours + (recordedByFeature.get(featureId) ?? 0);
		const rate = vmType ? Number(vmType.rate) : null;
		return {
			id: featureId,
			label: vmType?.name ?? featureId,
			resourceType: 'vm' as const,
			count: group.count,
			hours: Number(hours.toFixed(2)),
			cost: rate != null ? Number((hours * rate).toFixed(2)) : null
		};
	});

	return {
		customer: billingState.customer,
		status: billingState.status,
		statusLabel: statusLabel(billingState.status),
		planLabel: 'Project billing',
		setupRequired:
			billingState.status !== 'active' && billingState.status !== 'provider_unavailable',
		syncError: billingState.syncError,
		lastUpdatedAt: now,
		activeResourceCount: activeMeters.length,
		activeResources
	};
}
