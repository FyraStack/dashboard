import { and, eq, sum } from 'drizzle-orm';
import { initDrizzle } from '#lib/server/db/index.js';
import { billingMeters, billingUsageEvents, vmTypes } from '#lib/server/db/schema.js';
import { capHoursFor, periodAtFor, unmeteredBillableHours } from './caps.ts';
import { getProjectCreditsBalance, getProjectInvoices } from './credits.ts';
import { lookupProjectBillingPeriod } from './period.ts';
import { getProjectBillingStatus, isBillingUsable } from './state.ts';
import { billedQuantity, estimatedCost } from './usage.ts';

async function billingPeriodAnchor(projectId: string) {
	try {
		const lookup = await lookupProjectBillingPeriod(projectId);
		return lookup.customer === 'found' ? lookup.anchor : null;
	} catch (err) {
		console.warn(`Failed to look up the billing period for project ${projectId}`, err);
		return null;
	}
}

export async function getProjectBillingReadiness(projectId: string) {
	return { setupRequired: !isBillingUsable(await getProjectBillingStatus(projectId)) };
}

export async function getProjectBillingOverview(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	const [billingStatus, credits, invoices] = await Promise.all([
		getProjectBillingStatus(projectId),
		getProjectCreditsBalance(projectId),
		getProjectInvoices(projectId)
	]);

	const activeMeters = await db
		.select({
			resourceId: billingMeters.resourceId,
			featureId: billingMeters.featureId,
			units: billingMeters.units,
			lastMeteredAt: billingMeters.lastMeteredAt,
			capPeriodStart: billingMeters.capPeriodStart,
			capPeriodEnd: billingMeters.capPeriodEnd,
			hoursThisPeriod: billingMeters.hoursThisPeriod
		})
		.from(billingMeters)
		.where(
			and(
				eq(billingMeters.projectId, projectId),
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.active, true)
			)
		);

	const recordedRows = await db
		.select({ featureId: billingUsageEvents.featureId, hours: sum(billingUsageEvents.quantity) })
		.from(billingUsageEvents)
		.where(
			and(eq(billingUsageEvents.projectId, projectId), eq(billingUsageEvents.resourceType, 'vm'))
		)
		.groupBy(billingUsageEvents.featureId);

	const vmTypeRows = await db
		.select({
			featureId: vmTypes.autumnFeatureId,
			name: vmTypes.name,
			rate: vmTypes.rate,
			cap: vmTypes.cap
		})
		.from(vmTypes);

	const recordedByFeature = new Map(
		recordedRows.map((row) => [row.featureId, Number(row.hours ?? 0)])
	);
	const vmTypeByFeature = new Map<string, { name: string; rate: string; capHours: number }>();
	for (const row of vmTypeRows) {
		if (row.featureId) {
			vmTypeByFeature.set(row.featureId, {
				name: row.name,
				rate: row.rate,
				capHours: capHoursFor(row.rate, row.cap)
			});
		}
	}

	const hasCappedMeter = activeMeters.some((meter) =>
		Number.isFinite(vmTypeByFeature.get(meter.featureId)?.capHours ?? Number.POSITIVE_INFINITY)
	);
	const periodAt = periodAtFor(hasCappedMeter ? await billingPeriodAnchor(projectId) : null);

	const groups = new Map<string, { count: number; liveHours: number }>();
	for (const meter of activeMeters) {
		const group = groups.get(meter.featureId) ?? { count: 0, liveHours: 0 };
		group.count += 1;
		const capHours = vmTypeByFeature.get(meter.featureId)?.capHours ?? Number.POSITIVE_INFINITY;
		group.liveHours += billedQuantity(
			meter.units,
			unmeteredBillableHours(meter, { now, capHours, periodAt })
		);
		groups.set(meter.featureId, group);
	}
	for (const featureId of recordedByFeature.keys()) {
		if (!groups.has(featureId)) {
			groups.set(featureId, { count: 0, liveHours: 0 });
		}
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
			cost: rate === null ? null : estimatedCost(hours, rate)
		};
	});

	return {
		setupRequired: !isBillingUsable(billingStatus),
		activeResourceCount: activeMeters.length,
		activeResources,
		credits,
		invoices
	};
}
