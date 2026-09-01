import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import {
	billingMeters,
	billingUsageEvents,
	organization,
	vms,
	vmTypes
} from '$lib/server/db/schema';
import { capHoursFor } from '$lib/server/billing/caps';
import { syncUsageEvent } from '$lib/server/billing/metering';

export type VmBillingUsage = {
	vmId: string;
	vmName: string;
	projectId: string | null;
	projectName: string | null;
	featureId: string | null;
	periodStart: number;
	periodEnd: number;
	billedHours: number;
	reversedHours: number;
	reversibleHours: number;
	eventCount: number;
	ratePerHour: string | null;
	estimatedAmount: number | null;
};

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

function roundHours(value: number) {
	return Number(value.toFixed(6));
}

async function computeVmUsage(
	db: ReturnType<typeof initDrizzle>,
	vmId: string,
	periodStart: number,
	periodEnd: number
): Promise<VmBillingUsage> {
	const [vm] = await db
		.select({
			id: vms.id,
			name: vms.name,
			projectId: vms.ownerProjectId,
			projectName: organization.name,
			vmTypeFeatureId: vmTypes.autumnFeatureId,
			ratePerHour: vmTypes.rate
		})
		.from(vms)
		.leftJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.leftJoin(organization, eq(organization.id, vms.ownerProjectId))
		.where(eq(vms.id, vmId))
		.limit(1);
	if (!vm) error(404, `VM "${vmId}" not found`);

	const events = await db
		.select({
			quantity: billingUsageEvents.quantity,
			featureId: billingUsageEvents.featureId
		})
		.from(billingUsageEvents)
		.where(
			and(
				eq(billingUsageEvents.resourceType, 'vm'),
				eq(billingUsageEvents.resourceId, vmId),
				gt(billingUsageEvents.periodEnd, periodStart),
				lte(billingUsageEvents.periodEnd, periodEnd)
			)
		)
		.orderBy(desc(billingUsageEvents.periodEnd));

	let billedHours = 0;
	let reversedHours = 0;
	let eventCount = 0;
	let eventFeatureId: string | null = null;
	for (const event of events) {
		const quantity = Number(event.quantity);
		if (quantity >= 0) {
			billedHours += quantity;
			eventCount += 1;
			eventFeatureId ??= event.featureId;
		} else {
			reversedHours += -quantity;
		}
	}

	billedHours = roundHours(billedHours);
	reversedHours = roundHours(reversedHours);
	const reversibleHours = roundHours(Math.max(0, billedHours - reversedHours));
	const featureId = eventFeatureId ?? vm.vmTypeFeatureId;
	const rate = vm.ratePerHour == null ? null : Number(vm.ratePerHour);

	return {
		vmId: vm.id,
		vmName: vm.name,
		projectId: vm.projectId,
		projectName: vm.projectName,
		featureId,
		periodStart,
		periodEnd,
		billedHours,
		reversedHours,
		reversibleHours,
		eventCount,
		ratePerHour: vm.ratePerHour,
		estimatedAmount:
			rate == null || Number.isNaN(rate) ? null : Number((reversibleHours * rate).toFixed(2))
	};
}

function validateWindow(periodStart: number, periodEnd: number) {
	if (periodStart >= periodEnd) error(400, 'The window start must be before its end');
	if (periodEnd > Date.now() + 60_000) error(400, 'The window cannot end in the future');
}

const usageParams = type({ vmId: 'string', periodStart: 'number', periodEnd: 'number' });

export const getVmBillingUsage = query(usageParams, async (params) => {
	const db = await requireCurrentAdmin();
	validateWindow(params.periodStart, params.periodEnd);

	return computeVmUsage(db, params.vmId, params.periodStart, params.periodEnd);
});

const reverseParams = type({
	vmId: 'string',
	periodStart: 'number',
	periodEnd: 'number',
	'note?': 'string'
});

export const reverseVmBillingUsage = command(reverseParams, async (params) => {
	const db = await requireCurrentAdmin();
	validateWindow(params.periodStart, params.periodEnd);

	const usage = await computeVmUsage(db, params.vmId, params.periodStart, params.periodEnd);
	if (usage.reversibleHours <= 0) error(400, 'No reversible usage in this window');
	if (!usage.featureId) error(400, 'This VM has no billing feature to reverse against');
	if (!usage.projectId) error(400, 'This VM has no project to credit');

	const meter = await db.query.billingMeters.findFirst({
		where: and(
			eq(billingMeters.resourceType, 'vm'),
			eq(billingMeters.resourceId, params.vmId),
			eq(billingMeters.active, true)
		)
	});
	const currentPeriodStart = Math.max(params.periodStart, meter?.capPeriodStart ?? Infinity);
	const currentPeriodEnd = Math.min(params.periodEnd, meter?.capPeriodEnd ?? -Infinity);
	const currentPeriodUsage =
		currentPeriodStart < currentPeriodEnd
			? await computeVmUsage(db, params.vmId, currentPeriodStart, currentPeriodEnd)
			: null;
	const currentPeriodReversibleHours = Math.min(
		usage.reversibleHours,
		currentPeriodUsage?.reversibleHours ?? 0
	);

	const now = Date.now();
	const idempotencyKey = [
		'reversal',
		'vm',
		params.vmId,
		usage.featureId,
		params.periodStart,
		params.periodEnd,
		usage.reversibleHours
	].join(':');

	const [event] = await db
		.insert(billingUsageEvents)
		.values({
			projectId: usage.projectId,
			resourceType: 'vm',
			resourceId: params.vmId,
			featureId: usage.featureId,
			quantity: (-usage.reversibleHours).toString(),
			periodStart: params.periodStart,
			periodEnd: params.periodEnd,
			idempotencyKey,
			note: params.note?.trim() || null,
			createdAt: now
		})
		.onConflictDoNothing({ target: billingUsageEvents.idempotencyKey })
		.returning();
	if (!event) error(409, 'An identical reversal was already recorded');

	if (
		meter?.capPeriodStart != null &&
		meter.capPeriodEnd != null &&
		currentPeriodReversibleHours > 0
	) {
		const meterUnits = Number(meter.units);
		const reversedMeterHours =
			Number.isFinite(meterUnits) && meterUnits > 0
				? currentPeriodReversibleHours / meterUnits
				: currentPeriodReversibleHours;
		const [vmType] = await db
			.select({ rate: vmTypes.rate, cap: vmTypes.cap })
			.from(vms)
			.innerJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
			.where(eq(vms.id, params.vmId))
			.limit(1);
		const capHours = capHoursFor(vmType?.rate, vmType?.cap);
		const billableCounter = Number.isFinite(capHours)
			? sql`least(${billingMeters.hoursThisPeriod}, ${capHours})`
			: sql`${billingMeters.hoursThisPeriod}`;

		await db
			.update(billingMeters)
			.set({
				hoursThisPeriod: sql`greatest(0, ${billableCounter} - ${reversedMeterHours})`
			})
			.where(
				and(
					eq(billingMeters.id, meter.id),
					eq(billingMeters.capPeriodStart, meter.capPeriodStart),
					eq(billingMeters.capPeriodEnd, meter.capPeriodEnd)
				)
			);
	}

	const syncStatus = await syncUsageEvent(event.id);

	return {
		reversedHours: usage.reversibleHours,
		estimatedAmount: usage.estimatedAmount,
		syncStatus
	};
});
