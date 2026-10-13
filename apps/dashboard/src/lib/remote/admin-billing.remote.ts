import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, desc, eq, gt, lte, ne, notExists, sql } from 'drizzle-orm';
import { requireAdmin } from '#lib/server/auth-context.js';
import { capHoursFor } from '#lib/server/billing/caps.js';
import { syncUsageEvent } from '#lib/server/billing/metering.js';
import { organization } from '#lib/server/db/auth.schema.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import {
	billingMeters,
	billingUsageEvents,
	billingUsageReversals,
	vms,
	vmTypes
} from '#lib/server/db/schema.js';
import { command, getRequestEvent, query } from '$app/server';

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

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

function roundHours(value: number) {
	return Number(value.toFixed(6));
}

type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

interface ReversibleSource {
	id: string;
	periodEnd: number;
	quantity: number;
}

async function computeVmUsage(
	db: DbExecutor,
	vmId: string,
	periodStart: number,
	periodEnd: number
): Promise<{ usage: VmBillingUsage; unreversedSources: ReversibleSource[] }> {
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

	const inWindow = and(
		eq(billingUsageEvents.resourceType, 'vm'),
		eq(billingUsageEvents.resourceId, vmId),
		gt(billingUsageEvents.periodEnd, periodStart),
		lte(billingUsageEvents.periodEnd, periodEnd)
	);

	const sources = await db
		.select({
			id: billingUsageEvents.id,
			quantity: billingUsageEvents.quantity,
			featureId: billingUsageEvents.featureId,
			periodEnd: billingUsageEvents.periodEnd,
			reversalEventId: billingUsageReversals.reversalEventId
		})
		.from(billingUsageEvents)
		.leftJoin(billingUsageReversals, eq(billingUsageReversals.sourceEventId, billingUsageEvents.id))
		.where(
			and(
				inWindow,
				sql`${billingUsageEvents.quantity} >= 0`,
				ne(billingUsageEvents.syncStatus, 'abandoned')
			)
		)
		.orderBy(desc(billingUsageEvents.periodEnd));

	const legacyReversals = await db
		.select({ quantity: billingUsageEvents.quantity })
		.from(billingUsageEvents)
		.where(
			and(
				inWindow,
				sql`${billingUsageEvents.quantity} < 0`,
				notExists(
					db
						.select({ id: billingUsageReversals.sourceEventId })
						.from(billingUsageReversals)
						.where(eq(billingUsageReversals.reversalEventId, billingUsageEvents.id))
				)
			)
		);

	let billedHours = 0;
	let reversedHours = 0;
	let eventFeatureId: string | null = null;
	const unreversedSources: ReversibleSource[] = [];
	for (const source of sources) {
		const quantity = Number(source.quantity);
		billedHours += quantity;
		eventFeatureId ??= source.featureId;
		if (source.reversalEventId === null) {
			unreversedSources.push({ id: source.id, periodEnd: source.periodEnd, quantity });
		} else {
			reversedHours += quantity;
		}
	}
	for (const reversal of legacyReversals) {
		reversedHours += -Number(reversal.quantity);
	}

	billedHours = roundHours(billedHours);
	reversedHours = roundHours(reversedHours);
	const reversibleHours = roundHours(Math.max(0, billedHours - reversedHours));
	const featureId = eventFeatureId ?? vm.vmTypeFeatureId;
	const rate = vm.ratePerHour === null ? null : Number(vm.ratePerHour);

	return {
		unreversedSources,
		usage: {
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
			eventCount: sources.length,
			ratePerHour: vm.ratePerHour,
			estimatedAmount:
				rate === null || Number.isNaN(rate) ? null : Number((reversibleHours * rate).toFixed(2))
		}
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

const usageParams = type({ vmId: 'string', periodStart: 'number', periodEnd: 'number' });

export const getVmBillingUsage = query(usageParams, async (params) => {
	const db = await requireCurrentAdmin();
	validateWindow(params.periodStart, params.periodEnd);

	const { usage } = await computeVmUsage(db, params.vmId, params.periodStart, params.periodEnd);
	return usage;
});

const reverseParams = type({
	vmId: 'string',
	periodStart: 'number',
	periodEnd: 'number',
	'note?': 'string'
});

type BillingMeter = typeof billingMeters.$inferSelect;

function currentPeriodSourceHours(meter: BillingMeter | undefined, sources: ReversibleSource[]) {
	const capPeriodStart = meter?.capPeriodStart ?? null;
	const capPeriodEnd = meter?.capPeriodEnd ?? null;
	if (capPeriodStart === null || capPeriodEnd === null) {
		return 0;
	}

	const hours = sources
		.filter((source) => source.periodEnd > capPeriodStart && source.periodEnd <= capPeriodEnd)
		.reduce((total, source) => total + source.quantity, 0);
	return roundHours(hours);
}

async function releaseMeterCapHours(
	tx: DbExecutor,
	meter: BillingMeter,
	vmId: string,
	reversedHours: number
) {
	if (meter.capPeriodStart === null || meter.capPeriodEnd === null) {
		return;
	}

	const meterUnits = Number(meter.units);
	const reversedMeterHours =
		Number.isFinite(meterUnits) && meterUnits > 0 ? reversedHours / meterUnits : reversedHours;
	const [vmType] = await tx
		.select({ rate: vmTypes.rate, cap: vmTypes.cap })
		.from(vms)
		.innerJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.where(eq(vms.id, vmId))
		.limit(1);
	const capHours = capHoursFor(vmType?.rate, vmType?.cap);
	const billableCounter = Number.isFinite(capHours)
		? sql`least(${billingMeters.hoursThisPeriod}, ${capHours})`
		: sql`${billingMeters.hoursThisPeriod}`;

	await tx
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

export const reverseVmBillingUsage = command(reverseParams, async (params) => {
	const db = await requireCurrentAdmin();
	validateWindow(params.periodStart, params.periodEnd);

	const { event, reversed } = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`vm-billing-reversal:${params.vmId}`}))`
		);

		const { usage, unreversedSources } = await computeVmUsage(
			tx,
			params.vmId,
			params.periodStart,
			params.periodEnd
		);
		if (usage.reversibleHours <= 0 || unreversedSources.length === 0) {
			error(400, 'No reversible usage in this window');
		}
		if (!usage.featureId) {
			error(400, 'This VM has no billing feature to reverse against');
		}
		if (!usage.projectId) {
			error(400, 'This VM has no project to credit');
		}

		const meter = await tx.query.billingMeters.findFirst({
			where: and(
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.resourceId, params.vmId),
				eq(billingMeters.active, true)
			)
		});
		const currentPeriodReversibleHours = Math.min(
			usage.reversibleHours,
			currentPeriodSourceHours(meter, unreversedSources)
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

		const [reversal] = await tx
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
		if (!reversal) {
			error(409, 'An identical reversal was already recorded');
		}

		const linked = await tx
			.insert(billingUsageReversals)
			.values(
				unreversedSources.map((source) => ({
					sourceEventId: source.id,
					reversalEventId: reversal.id,
					createdAt: now
				}))
			)
			.onConflictDoNothing({ target: billingUsageReversals.sourceEventId })
			.returning({ sourceEventId: billingUsageReversals.sourceEventId });
		if (linked.length !== unreversedSources.length) {
			error(409, 'Some of this usage was already reversed. Reload and try again.');
		}

		if (meter && currentPeriodReversibleHours > 0) {
			await releaseMeterCapHours(tx, meter, params.vmId, currentPeriodReversibleHours);
		}

		return { event: reversal, reversed: usage };
	});

	const syncStatus = await syncUsageEvent(event.id);

	return {
		reversedHours: reversed.reversibleHours,
		estimatedAmount: reversed.estimatedAmount,
		syncStatus
	};
});
