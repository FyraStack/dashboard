import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import {
	billingMeters,
	billingUsageEvents,
	organization,
	vms,
	vmTypes,
	type billingResourceTypeEnum
} from '$lib/server/db/schema';
import { requireVmFeatureId, usageIdempotencyKey, usageQuantity } from './features';
import {
	autumnStatus,
	createAutumnClient,
	ensureProjectCustomer,
	ensureProjectServerEntity,
	formatAutumnError,
	isBillingConfigured,
	isProjectBillingExempt
} from './autumn';

type BillingResourceType = (typeof billingResourceTypeEnum.enumValues)[number];
type BillingMeter = typeof billingMeters.$inferSelect;
type BillingUsageEvent = typeof billingUsageEvents.$inferSelect;

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

	return db.transaction(async (tx) => {
		const claimed = await tx
			.update(billingMeters)
			.set({ lastMeteredAt: now })
			.where(
				and(eq(billingMeters.id, meter.id), eq(billingMeters.lastMeteredAt, meter.lastMeteredAt))
			)
			.returning({ id: billingMeters.id });

		if (claimed.length === 0) return null;

		const [event] = await tx
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

		return event ?? null;
	});
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

	const missing = await db
		.select({
			id: vms.id,
			ownerProjectId: vms.ownerProjectId,
			createdAt: vms.createdAt,
			vmType: { name: vmTypes.name, autumnFeatureId: vmTypes.autumnFeatureId }
		})
		.from(vms)
		.innerJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.leftJoin(
			billingMeters,
			and(eq(billingMeters.resourceType, 'vm'), eq(billingMeters.resourceId, vms.id))
		)
		.where(
			and(
				eq(vms.active, true),
				isNull(billingMeters.id),
				projectId ? eq(vms.ownerProjectId, projectId) : undefined
			)
		)
		.limit(limit);

	for (const vm of missing) {
		if (!vm.ownerProjectId) continue;

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

	const event = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(billingMeters)
			.where(and(eq(billingMeters.id, meter.id), eq(billingMeters.active, true)))
			.for('update');

		if (!locked) return null;

		let inserted: BillingUsageEvent | null = null;
		const quantity = usageQuantity(locked.units, locked.lastMeteredAt, now);
		if (now > locked.lastMeteredAt && quantity > 0) {
			const idempotencyKey = usageIdempotencyKey({
				resourceType: locked.resourceType,
				resourceId: locked.resourceId,
				featureId: locked.featureId,
				units: locked.units,
				periodStart: locked.lastMeteredAt,
				periodEnd: now
			});

			const rows = await tx
				.insert(billingUsageEvents)
				.values({
					projectId: locked.projectId,
					resourceType: locked.resourceType,
					resourceId: locked.resourceId,
					featureId: locked.featureId,
					quantity: quantity.toString(),
					periodStart: locked.lastMeteredAt,
					periodEnd: now,
					idempotencyKey,
					createdAt: now
				})
				.onConflictDoNothing({ target: billingUsageEvents.idempotencyKey })
				.returning();
			inserted = rows[0] ?? null;
		}

		await tx
			.update(billingMeters)
			.set({ lastMeteredAt: now, active: false, endedAt: now })
			.where(eq(billingMeters.id, meter.id));

		return inserted;
	});

	const syncStatus = event ? await syncUsageEvent(event.id) : null;

	return { event, syncStatus };
}

export async function reconcileOrphanedMeters(now = Date.now(), limit = 100) {
	const db = initDrizzle();
	const orphans = await db
		.select({
			id: billingMeters.id,
			projectId: billingMeters.projectId,
			resourceId: billingMeters.resourceId
		})
		.from(billingMeters)
		.leftJoin(vms, eq(vms.id, billingMeters.resourceId))
		.leftJoin(organization, eq(organization.id, billingMeters.projectId))
		.where(
			and(
				eq(billingMeters.active, true),
				eq(billingMeters.resourceType, 'vm'),
				or(
					isNull(vms.id),
					eq(vms.active, false),
					isNull(organization.id),
					isNotNull(organization.deletedAt)
				)
			)
		)
		.limit(limit);

	if (orphans.length === 0) return { closed: 0 };

	await db
		.update(billingMeters)
		.set({ active: false, endedAt: now })
		.where(
			inArray(
				billingMeters.id,
				orphans.map((orphan) => orphan.id)
			)
		);

	for (const orphan of orphans) {
		console.error(
			`Closed orphaned billing meter ${orphan.id} for project ${orphan.projectId}, resource ${orphan.resourceId}`
		);
	}

	return { closed: orphans.length };
}

export async function closeProjectMeters(projectId: string, now = Date.now()) {
	const db = initDrizzle();
	const closed = await db
		.update(billingMeters)
		.set({ active: false, endedAt: now })
		.where(and(eq(billingMeters.projectId, projectId), eq(billingMeters.active, true)))
		.returning({ id: billingMeters.id });

	return closed.length;
}

export async function abandonProjectUsageEvents(projectId: string, reason: string) {
	const db = initDrizzle();
	const abandoned = await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'abandoned', syncError: reason })
		.where(
			and(
				eq(billingUsageEvents.projectId, projectId),
				inArray(billingUsageEvents.syncStatus, ['pending', 'failed'])
			)
		)
		.returning({ id: billingUsageEvents.id });

	return abandoned.length;
}

export async function meterActiveResources(now = Date.now(), limit = 100) {
	const db = initDrizzle();
	await reconcileMissingMeters(now, limit);

	const meters = await db
		.select()
		.from(billingMeters)
		.where(
			and(
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.active, true),
				lt(billingMeters.lastMeteredAt, now)
			)
		)
		.orderBy(asc(billingMeters.lastMeteredAt))
		.limit(limit);

	const events: BillingUsageEvent[] = [];
	await runBounded(meters, METER_CONCURRENCY, async (meter) => {
		const event = await recordMeterUsage(meter, now);
		if (event) events.push(event);
	});

	return { meters: meters.length, events: events.length };
}

type ProjectTargetStatus = 'ok' | 'failed' | 'gone';
type EventTargetStatus = 'ready' | 'failed' | 'abandoned';

type EnsureCaches = {
	projects: Map<string, Promise<ProjectTargetStatus>>;
	entities: Map<string, Promise<boolean>>;
};

const SYNC_CONCURRENCY = 6;
const METER_CONCURRENCY = 5;

async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
	let index = 0;
	const runner = async () => {
		while (index < items.length) {
			await worker(items[index++]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

async function markUsageEventFailed(eventId: string, error: string) {
	const db = initDrizzle();
	await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'failed', syncError: error })
		.where(eq(billingUsageEvents.id, eventId));
}

async function markUsageEventAbandoned(eventId: string, error: string) {
	const db = initDrizzle();
	await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'abandoned', syncError: error })
		.where(eq(billingUsageEvents.id, eventId));
}

async function projectIsGone(projectId: string) {
	const db = initDrizzle();
	const [org] = await db
		.select({ deletedAt: organization.deletedAt })
		.from(organization)
		.where(eq(organization.id, projectId))
		.limit(1);

	return !org || org.deletedAt != null;
}

async function markUsageEventSynced(eventId: string) {
	const db = initDrizzle();
	await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'synced', syncError: null, syncedAt: Date.now() })
		.where(eq(billingUsageEvents.id, eventId));
}

function ensureProjectTarget(projectId: string, caches: EnsureCaches) {
	let ensured = caches.projects.get(projectId);
	if (!ensured) {
		ensured = ensureProjectCustomer(projectId)
			.then((): ProjectTargetStatus => 'ok')
			.catch(async (): Promise<ProjectTargetStatus> => {
				const gone = await projectIsGone(projectId).catch(() => false);
				return gone ? 'gone' : 'failed';
			});
		caches.projects.set(projectId, ensured);
	}

	return ensured;
}

function ensureEntityTarget(
	event: BillingUsageEvent,
	caches: EnsureCaches,
	customerEnsured: boolean
) {
	const db = initDrizzle();
	const entityKey = `${event.projectId}:${event.resourceId}`;
	let ensured = caches.entities.get(entityKey);
	if (!ensured) {
		ensured = (async () => {
			const vm = await db.query.vms.findFirst({
				where: eq(vms.id, event.resourceId),
				columns: { name: true }
			});
			await ensureProjectServerEntity({
				projectId: event.projectId,
				serverId: event.resourceId,
				name: vm?.name,
				customerEnsured
			});
			return true;
		})().catch(() => false);
		caches.entities.set(entityKey, ensured);
	}

	return ensured;
}

async function ensureEventTarget(
	event: BillingUsageEvent,
	caches: EnsureCaches
): Promise<EventTargetStatus> {
	const customerStatus = await ensureProjectTarget(event.projectId, caches);
	if (customerStatus === 'gone') {
		await markUsageEventAbandoned(event.id, 'Project no longer exists');
		return 'abandoned';
	}
	if (customerStatus !== 'ok') {
		await markUsageEventFailed(event.id, 'Failed to ensure Autumn customer');
		return 'failed';
	}

	if (event.resourceType === 'vm') {
		const entityEnsured = await ensureEntityTarget(event, caches, true);
		if (!entityEnsured) {
			await markUsageEventFailed(event.id, 'Failed to ensure Autumn entity');
			return 'failed';
		}
	}

	return 'ready';
}

async function trackUsageEvent(event: BillingUsageEvent) {
	if (!isBillingConfigured()) {
		await markUsageEventSynced(event.id);
		return 'synced' as const;
	}

	const db = initDrizzle();
	try {
		const payload = {
			customerId: event.projectId,
			featureId: event.featureId,
			value: Number(event.quantity),
			...(event.resourceType === 'vm' ? { entityId: event.resourceId } : {}),
			properties: {
				resourceType: event.resourceType,
				resourceId: event.resourceId,
				periodStart: event.periodStart,
				periodEnd: event.periodEnd,
				...(event.note ? { note: event.note } : {})
			}
		};

		await createAutumnClient().track(payload, {
			headers: { 'Idempotency-Key': event.idempotencyKey }
		});

		await db
			.update(billingUsageEvents)
			.set({ syncStatus: 'synced', syncError: null, syncedAt: Date.now() })
			.where(eq(billingUsageEvents.id, event.id));
		return 'synced' as const;
	} catch (err) {
		if (autumnStatus(err) === 404) {
			await markUsageEventAbandoned(event.id, formatAutumnError(err));
			return 'abandoned' as const;
		}
		await markUsageEventFailed(event.id, formatAutumnError(err));
		return 'failed' as const;
	}
}

async function syncUsageEvents(events: BillingUsageEvent[]) {
	const caches: EnsureCaches = { projects: new Map(), entities: new Map() };
	const ready: BillingUsageEvent[] = [];
	let synced = 0;
	let failed = 0;
	let abandoned = 0;

	await runBounded(events, SYNC_CONCURRENCY, async (event) => {
		if (event.syncStatus === 'synced') {
			synced += 1;
			return;
		}
		if (await isProjectBillingExempt(event.projectId)) {
			await markUsageEventSynced(event.id);
			synced += 1;
			return;
		}
		const target = await ensureEventTarget(event, caches);
		if (target === 'ready') ready.push(event);
		else if (target === 'abandoned') abandoned += 1;
		else failed += 1;
	});

	await runBounded(ready, SYNC_CONCURRENCY, async (event) => {
		const status = await trackUsageEvent(event);
		if (status === 'synced') synced += 1;
		else if (status === 'abandoned') abandoned += 1;
		else failed += 1;
	});

	return { synced, failed, abandoned };
}

export async function syncUsageEvent(id: string) {
	const db = initDrizzle();
	const event = await db.query.billingUsageEvents.findFirst({
		where: eq(billingUsageEvents.id, id)
	});

	if (!event) return null;
	if (event.syncStatus === 'synced') return 'synced' as const;
	if (await isProjectBillingExempt(event.projectId)) {
		await markUsageEventSynced(event.id);
		return 'synced' as const;
	}

	const caches: EnsureCaches = { projects: new Map(), entities: new Map() };
	const target = await ensureEventTarget(event, caches);
	if (target !== 'ready')
		return target === 'abandoned' ? ('abandoned' as const) : ('failed' as const);

	return trackUsageEvent(event);
}

const FAILED_EVENT_MAX_AGE_MS = 7 * 86_400_000;

async function abandonStaleFailedEvents(now: number) {
	const db = initDrizzle();
	const stale = await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'abandoned' })
		.where(
			and(
				eq(billingUsageEvents.syncStatus, 'failed'),
				lt(billingUsageEvents.createdAt, now - FAILED_EVENT_MAX_AGE_MS)
			)
		)
		.returning({ id: billingUsageEvents.id });

	if (stale.length > 0) {
		console.error(
			`Abandoned ${stale.length} usage events that stayed failed for over ${FAILED_EVENT_MAX_AGE_MS / 86_400_000} days`
		);
	}

	return stale.length;
}

export async function syncPendingUsage(limit = 50) {
	const db = initDrizzle();
	const expired = await abandonStaleFailedEvents(Date.now());
	const events = await db
		.select()
		.from(billingUsageEvents)
		.where(inArray(billingUsageEvents.syncStatus, ['pending', 'failed']))
		.orderBy(
			sql`case when ${billingUsageEvents.syncStatus} = 'pending' then 0 else 1 end`,
			asc(billingUsageEvents.createdAt)
		)
		.limit(limit);

	const { synced, failed, abandoned } = await syncUsageEvents(events);

	return { attempted: events.length, synced, failed, abandoned, expired };
}

export async function syncProjectUsage(projectId: string, limit = 50) {
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
		.orderBy(
			sql`case when ${billingUsageEvents.syncStatus} = 'pending' then 0 else 1 end`,
			asc(billingUsageEvents.createdAt)
		)
		.limit(limit);

	const { synced, failed, abandoned } = await syncUsageEvents(events);

	return { attempted: events.length, synced, failed, abandoned };
}
