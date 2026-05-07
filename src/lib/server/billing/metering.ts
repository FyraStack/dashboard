import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { Autumn } from 'autumn-js';
import { initDrizzle } from '$lib/server/db';
import {
	billingMeters,
	billingUsageEvents,
	vms,
	volumes,
	type billingResourceTypeEnum
} from '$lib/server/db/schema';
import { getRuntimeEnv } from '$lib/server/env';
import {
	requireVmFeatureId,
	usageIdempotencyKey,
	usageQuantity,
	VOLUME_GIB_HOURS_FEATURE_ID
} from './features';
import { ensureProjectCustomer, formatAutumnError } from './autumn';

type BillingResourceType = (typeof billingResourceTypeEnum.enumValues)[number];
type BillingMeter = typeof billingMeters.$inferSelect;
type BillingUsageEvent = typeof billingUsageEvents.$inferSelect;

function autumnClient() {
	const env = getRuntimeEnv();

	return new Autumn({ secretKey: env.AUTUMN_SECRET });
}

async function recordMeterUsage(meter: BillingMeter, now: number) {
	const db = initDrizzle();
	if (now <= meter.lastMeteredAt) return null;

	const quantity = usageQuantity(meter.units, meter.lastMeteredAt, now);
	if (quantity <= 0) return null;

	const idempotencyKey = usageIdempotencyKey({
		resourceType: meter.resourceType,
		resourceId: meter.resourceId,
		featureId: meter.featureId,
		units: meter.units,
		periodStart: meter.lastMeteredAt,
		periodEnd: now
	});

	const [event] = await db
		.insert(billingUsageEvents)
		.values({
			projectId: meter.projectId,
			resourceType: meter.resourceType,
			resourceId: meter.resourceId,
			featureId: meter.featureId,
			quantity: quantity.toString(),
			periodStart: meter.lastMeteredAt,
			periodEnd: now,
			idempotencyKey,
			createdAt: now
		})
		.onConflictDoNothing({ target: billingUsageEvents.idempotencyKey })
		.returning();

	await db.update(billingMeters).set({ lastMeteredAt: now }).where(eq(billingMeters.id, meter.id));

	return event ?? null;
}

export async function createBillingMeter(input: {
	projectId: string;
	resourceType: BillingResourceType;
	resourceId: string;
	featureId: string;
	units: number | string;
	now?: number;
}) {
	const db = initDrizzle();
	const now = input.now ?? Date.now();

	await db
		.insert(billingMeters)
		.values({
			projectId: input.projectId,
			resourceType: input.resourceType,
			resourceId: input.resourceId,
			featureId: input.featureId,
			units: input.units.toString(),
			lastMeteredAt: now,
			createdAt: now
		})
		.onConflictDoNothing({ target: [billingMeters.resourceType, billingMeters.resourceId] });
}

export async function reconcileMissingMeters(now = Date.now(), limit = 100, projectId?: string) {
	const db = initDrizzle();
	let created = 0;

	const activeVms = await db.query.vms.findMany({
		where: projectId
			? and(eq(vms.active, true), eq(vms.ownerProjectId, projectId))
			: eq(vms.active, true),
		with: { vmType: true },
		limit
	});

	for (const vm of activeVms) {
		if (!vm.ownerProjectId || !vm.vmType) continue;

		const existing = await db.query.billingMeters.findFirst({
			where: and(eq(billingMeters.resourceType, 'vm'), eq(billingMeters.resourceId, vm.id))
		});
		if (existing) continue;

		try {
			await createBillingMeter({
				projectId: vm.ownerProjectId,
				resourceType: 'vm',
				resourceId: vm.id,
				featureId: requireVmFeatureId(vm.vmType),
				units: 1,
				now: vm.createdAt
			});
			created += 1;
		} catch (err) {
			console.warn(`Skipping billing meter reconciliation for VM ${vm.id}`, err);
		}
	}

	const projectVolumes = await db.query.volumes.findMany({
		...(projectId ? { where: eq(volumes.ownerProjectId, projectId) } : {}),
		limit
	});

	for (const volume of projectVolumes) {
		const existing = await db.query.billingMeters.findFirst({
			where: and(eq(billingMeters.resourceType, 'volume'), eq(billingMeters.resourceId, volume.id))
		});
		if (existing) continue;

		await createBillingMeter({
			projectId: volume.ownerProjectId,
			resourceType: 'volume',
			resourceId: volume.id,
			featureId: VOLUME_GIB_HOURS_FEATURE_ID,
			units: volume.size,
			now: volume.createdAt
		});
		created += 1;
	}

	return { created };
}

export async function meterResourceThrough(
	resourceType: BillingResourceType,
	resourceId: string,
	now = Date.now()
) {
	const db = initDrizzle();
	const meter = await db.query.billingMeters.findFirst({
		where: and(
			eq(billingMeters.resourceType, resourceType),
			eq(billingMeters.resourceId, resourceId),
			eq(billingMeters.active, true)
		)
	});

	if (!meter) return null;

	const event = await recordMeterUsage(meter, now);
	await db
		.update(billingMeters)
		.set({ active: false, endedAt: now })
		.where(eq(billingMeters.id, meter.id));

	if (event) await syncUsageEvent(event.id);

	return event;
}

export async function meterActiveResources(now = Date.now(), limit = 100) {
	const db = initDrizzle();
	await reconcileMissingMeters(now, limit);

	const meters = await db
		.select()
		.from(billingMeters)
		.where(and(eq(billingMeters.active, true), lt(billingMeters.lastMeteredAt, now)))
		.orderBy(asc(billingMeters.lastMeteredAt))
		.limit(limit);

	const events: BillingUsageEvent[] = [];
	for (const meter of meters) {
		const event = await recordMeterUsage(meter, now);
		if (event) events.push(event);
	}

	for (const event of events) {
		await syncUsageEvent(event.id);
	}

	return { meters: meters.length, events: events.length };
}

export async function meterProjectActiveResources(
	projectId: string,
	now = Date.now(),
	limit = 100
) {
	const db = initDrizzle();
	await reconcileMissingMeters(now, limit, projectId);

	const meters = await db
		.select()
		.from(billingMeters)
		.where(
			and(
				eq(billingMeters.projectId, projectId),
				eq(billingMeters.active, true),
				lt(billingMeters.lastMeteredAt, now)
			)
		)
		.orderBy(asc(billingMeters.lastMeteredAt))
		.limit(limit);

	const events: BillingUsageEvent[] = [];
	for (const meter of meters) {
		const event = await recordMeterUsage(meter, now);
		if (event) events.push(event);
	}

	for (const event of events) {
		await syncUsageEvent(event.id);
	}

	return { resources: meters.length, usage: events.length };
}

export async function syncUsageEvent(id: string) {
	const db = initDrizzle();
	const event = await db.query.billingUsageEvents.findFirst({
		where: eq(billingUsageEvents.id, id)
	});

	if (!event || event.syncStatus === 'synced') return;

	try {
		await ensureProjectCustomer(event.projectId);
		await autumnClient().track(
			{
				customerId: event.projectId,
				featureId: event.featureId,
				value: Number(event.quantity),
				properties: {
					resourceType: event.resourceType,
					resourceId: event.resourceId,
					periodStart: event.periodStart,
					periodEnd: event.periodEnd
				}
			},
			{ headers: { 'Idempotency-Key': event.idempotencyKey } }
		);

		await db
			.update(billingUsageEvents)
			.set({ syncStatus: 'synced', syncError: null, syncedAt: Date.now() })
			.where(eq(billingUsageEvents.id, event.id));
	} catch (err) {
		await db
			.update(billingUsageEvents)
			.set({ syncStatus: 'failed', syncError: formatAutumnError(err) })
			.where(eq(billingUsageEvents.id, event.id));
	}
}

export async function syncPendingUsage(limit = 100) {
	const db = initDrizzle();
	const events = await db
		.select()
		.from(billingUsageEvents)
		.where(inArray(billingUsageEvents.syncStatus, ['pending', 'failed']))
		.orderBy(asc(billingUsageEvents.createdAt))
		.limit(limit);

	for (const event of events) {
		await syncUsageEvent(event.id);
	}

	return { events: events.length };
}

export async function syncProjectUsage(projectId: string, limit = 100) {
	const db = initDrizzle();
	const events = await db
		.select()
		.from(billingUsageEvents)
		.where(
			and(
				eq(billingUsageEvents.projectId, projectId),
				inArray(billingUsageEvents.syncStatus, ['pending', 'failed'])
			)
		)
		.orderBy(asc(billingUsageEvents.createdAt))
		.limit(limit);

	for (const event of events) {
		await syncUsageEvent(event.id);
	}

	return { events: events.length };
}
