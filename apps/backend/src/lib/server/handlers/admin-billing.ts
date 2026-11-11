import { and, desc, eq, gt, lte } from 'drizzle-orm';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { releaseMeterCapHours, syncUsageEvents } from '#lib/server/billing/metering.js';
import { estimatedCost, reversalIdempotencyKey } from '#lib/server/billing/usage.js';
import { organization } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { billingMeters, billingUsageEvents, vms, vmTypes } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';

export interface VmBillingUsage {
	billedHours: number;
	estimatedAmount: number | null;
	eventCount: number;
	featureId: string | null;
	periodEnd: number;
	periodStart: number;
	projectId: string | null;
	projectName: string | null;
	ratePerHour: string | null;
	reversedHours: number;
	reversibleHours: number;
	vmId: string;
	vmName: string;
}

function roundHours(value: number) {
	return Number(value.toFixed(6));
}

async function computeVmUsage(
	db: Database,
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
	if (!vm) {
		error(404, `VM "${vmId}" not found`);
	}

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
	const rate = vm.ratePerHour === null ? null : Number(vm.ratePerHour);

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
			rate === null || Number.isNaN(rate) ? null : estimatedCost(reversibleHours, rate)
	};
}

function validateWindow(periodStart: number, periodEnd: number) {
	if (periodStart >= periodEnd) {
		error(400, 'The window start must be before its end');
	}
	if (periodEnd > Date.now() + 60_000) {
		error(400, 'The window cannot end in the future');
	}
}

export interface VmBillingUsageInput {
	periodEnd: number;
	periodStart: number;
	vmId: string;
}

export async function getVmBillingUsage(params: VmBillingUsageInput) {
	const { db } = await requireAdminUser();
	validateWindow(params.periodStart, params.periodEnd);

	return computeVmUsage(db, params.vmId, params.periodStart, params.periodEnd);
}

export interface ReverseVmBillingUsageInput {
	note?: string;
	periodEnd: number;
	periodStart: number;
	vmId: string;
}

export async function reverseVmBillingUsage(params: ReverseVmBillingUsageInput) {
	const { db } = await requireAdminUser();
	validateWindow(params.periodStart, params.periodEnd);

	const usage = await computeVmUsage(db, params.vmId, params.periodStart, params.periodEnd);
	if (usage.reversibleHours <= 0) {
		error(400, 'No reversible usage in this window');
	}
	if (!usage.featureId) {
		error(400, 'This VM has no billing feature to reverse against');
	}
	if (!usage.projectId) {
		error(400, 'This VM has no project to credit');
	}

	const meter = await db.query.billingMeters.findFirst({
		where: and(
			eq(billingMeters.resourceType, 'vm'),
			eq(billingMeters.resourceId, params.vmId),
			eq(billingMeters.active, true)
		)
	});
	const currentPeriodStart = Math.max(
		params.periodStart,
		meter?.capPeriodStart ?? Number.POSITIVE_INFINITY
	);
	const currentPeriodEnd = Math.min(
		params.periodEnd,
		meter?.capPeriodEnd ?? Number.NEGATIVE_INFINITY
	);
	const currentPeriodUsage =
		currentPeriodStart < currentPeriodEnd
			? await computeVmUsage(db, params.vmId, currentPeriodStart, currentPeriodEnd)
			: null;
	const currentPeriodReversibleHours = Math.min(
		usage.reversibleHours,
		currentPeriodUsage?.reversibleHours ?? 0
	);

	const now = Date.now();
	const idempotencyKey = reversalIdempotencyKey({
		resourceType: 'vm',
		resourceId: params.vmId,
		featureId: usage.featureId,
		units: usage.reversibleHours,
		periodStart: params.periodStart,
		periodEnd: params.periodEnd
	});

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
	if (!event) {
		error(409, 'An identical reversal was already recorded');
	}

	if (
		meter !== undefined &&
		meter.capPeriodStart !== null &&
		meter.capPeriodEnd !== null &&
		currentPeriodReversibleHours > 0
	) {
		await releaseMeterCapHours({
			meterId: meter.id,
			periodStart: meter.capPeriodStart,
			periodEnd: meter.capPeriodEnd,
			releasedUsageHours: currentPeriodReversibleHours
		});
	}

	const [syncStatus] = await syncUsageEvents([event]);

	return {
		reversedHours: usage.reversibleHours,
		estimatedAmount: usage.estimatedAmount,
		syncStatus
	};
}
