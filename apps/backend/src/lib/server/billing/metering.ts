import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or } from 'drizzle-orm';
import type { VmLifecycleStatus } from 'stack-shared/vm-status';
import { organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { billingMeters, billingUsageEvents, vms, vmTypes } from '#lib/server/db/schema.js';
import { errorMessage } from '#lib/server/errors.js';
import { autumnStatus, createAutumnClient, isBillingConfigured } from './autumn.ts';
import {
	type CapPeriod,
	type CapSegment,
	capHoursFor,
	meteringWindowStart,
	periodAtFor,
	releaseCapHours,
	sliceCapUsage
} from './caps.ts';
import { ensureProjectCustomer } from './customers.ts';
import { ensureServerEntity } from './entities.ts';
import { isProjectBillingExempt } from './exemption.ts';
import { lookupProjectBillingPeriod, type ProjectBillingPeriodLookup } from './period.ts';
import {
	type BillingResourceType,
	billedQuantity,
	hoursBetween,
	requireVmFeatureId,
	usageIdempotencyKey
} from './usage.ts';

type BillingMeter = typeof billingMeters.$inferSelect;
type BillingUsageEvent = typeof billingUsageEvents.$inferSelect;

const CAPPED_USAGE_NOTE = 'Clamped to the monthly price cap';

function clampedMeteringStart(meter: Pick<BillingMeter, 'id' | 'lastMeteredAt'>, now: number) {
	const start = meteringWindowStart(meter.lastMeteredAt, now);
	if (start === meter.lastMeteredAt) {
		return start;
	}

	const skippedHours = hoursBetween(meter.lastMeteredAt, start).toFixed(2);
	console.error(
		`Billing meter ${meter.id} was last metered ${skippedHours}h beyond the catch-up limit; skipping unbilled hours before ${new Date(start).toISOString()}`
	);
	return start;
}

type SegmentInsert = Pick<
	BillingMeter,
	'projectId' | 'resourceType' | 'resourceId' | 'featureId' | 'units'
>;

function segmentEventValues(meter: SegmentInsert, segment: CapSegment, now: number) {
	const quantity = billedQuantity(meter.units, segment.billableHours);
	if (quantity <= 0) {
		return null;
	}

	return {
		projectId: meter.projectId,
		resourceType: meter.resourceType,
		resourceId: meter.resourceId,
		featureId: meter.featureId,
		quantity: quantity.toString(),
		periodStart: segment.periodStart,
		periodEnd: segment.periodEnd,
		idempotencyKey: usageIdempotencyKey({
			resourceType: meter.resourceType,
			resourceId: meter.resourceId,
			featureId: meter.featureId,
			units: meter.units,
			periodStart: segment.periodStart,
			periodEnd: segment.periodEnd
		}),
		note: segment.capped ? CAPPED_USAGE_NOTE : null,
		createdAt: now
	};
}

type MeterCapState = ReturnType<typeof sliceCapUsage>['state'];

function capStateColumns(state: MeterCapState) {
	return {
		capPeriodStart: state.capPeriodStart,
		capPeriodEnd: state.capPeriodEnd,
		hoursThisPeriod: state.hoursThisPeriod.toFixed(6)
	};
}

async function settleMeter(settlement: {
	meterId: string;
	capHours: number;
	periodAt: (at: number) => CapPeriod;
	createdAt: number;
	billable?: boolean;
	windowEnd: (locked: BillingMeter) => number | null;
	meterUpdate: (state: MeterCapState) => Partial<typeof billingMeters.$inferInsert>;
}) {
	const db = initDrizzle();

	return await db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(billingMeters)
			.where(and(eq(billingMeters.id, settlement.meterId), eq(billingMeters.active, true)))
			.for('update');
		if (!locked) {
			return [];
		}

		const to = settlement.windowEnd(locked);
		if (to === null) {
			return [];
		}

		const { segments, state } = sliceCapUsage({
			from: clampedMeteringStart(locked, to),
			to,
			capHours: settlement.capHours,
			state: locked,
			periodAt: settlement.periodAt
		});

		const values =
			settlement.billable === false
				? []
				: segments
						.map((segment) => segmentEventValues(locked, segment, settlement.createdAt))
						.filter((value) => value !== null);

		await tx
			.update(billingMeters)
			.set(settlement.meterUpdate(state))
			.where(eq(billingMeters.id, settlement.meterId));

		if (values.length === 0) {
			return [];
		}

		return tx
			.insert(billingUsageEvents)
			.values(values)
			.onConflictDoNothing({ target: billingUsageEvents.idempotencyKey })
			.returning();
	});
}

function recordMeterUsage(
	meter: BillingMeter,
	now: number,
	capHours: number,
	periodAt: (at: number) => CapPeriod
) {
	if (now <= meter.lastMeteredAt) {
		return [];
	}

	return settleMeter({
		meterId: meter.id,
		capHours,
		periodAt,
		createdAt: now,
		windowEnd: (locked) => (now <= locked.lastMeteredAt ? null : now),
		meterUpdate: (state) => ({ lastMeteredAt: now, ...capStateColumns(state) })
	});
}

export async function releaseMeterCapHours(input: {
	meterId: string;
	periodStart: number;
	periodEnd: number;
	releasedUsageHours: number;
}) {
	const db = initDrizzle();

	await db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(billingMeters)
			.where(and(eq(billingMeters.id, input.meterId), eq(billingMeters.active, true)))
			.for('update');
		if (
			!locked ||
			locked.capPeriodStart !== input.periodStart ||
			locked.capPeriodEnd !== input.periodEnd
		) {
			return;
		}

		const units = Number(locked.units);
		const releasedMeterHours =
			Number.isFinite(units) && units > 0
				? input.releasedUsageHours / units
				: input.releasedUsageHours;
		const capHours = await capHoursForMeter(locked);

		await tx
			.update(billingMeters)
			.set({
				hoursThisPeriod: releaseCapHours(
					locked.hoursThisPeriod,
					capHours,
					releasedMeterHours
				).toFixed(6)
			})
			.where(eq(billingMeters.id, locked.id));
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

async function reconcileMissingMeters(now: number, limit: number) {
	const db = initDrizzle();

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
		.where(and(eq(vms.active, true), isNull(billingMeters.id)))
		.limit(limit);

	const reseeded = await Promise.all(missing.map((vm) => reseedMissingMeter(vm, now)));
	return { created: reseeded.filter(Boolean).length };
}

async function reseedMissingMeter(
	vm: {
		id: string;
		ownerProjectId: string | null;
		createdAt: number;
		vmType: Parameters<typeof requireVmFeatureId>[0];
	},
	now: number
) {
	if (!vm.ownerProjectId) {
		return false;
	}

	try {
		await createBillingMeter({
			projectId: vm.ownerProjectId,
			resourceType: 'vm',
			resourceId: vm.id,
			featureId: requireVmFeatureId(vm.vmType),
			units: 1,
			now
		});
		console.error(
			`Reseeded missing billing meter for VM ${vm.id} (project ${vm.ownerProjectId}, created ${new Date(vm.createdAt).toISOString()}); metering resumes from now`
		);
		return true;
	} catch (err) {
		console.warn(`Skipping billing meter reconciliation for VM ${vm.id}`, err);
		return false;
	}
}

async function vmTypeBilledByMeter(meter: Pick<BillingMeter, 'featureId' | 'resourceId'>) {
	const db = initDrizzle();
	const [byFeature] = await db
		.select({ rate: vmTypes.rate, cap: vmTypes.cap })
		.from(vmTypes)
		.where(eq(vmTypes.autumnFeatureId, meter.featureId))
		.limit(1);
	if (byFeature) {
		return byFeature;
	}

	const [byVm] = await db
		.select({ rate: vmTypes.rate, cap: vmTypes.cap })
		.from(vms)
		.innerJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.where(eq(vms.id, meter.resourceId))
		.limit(1);
	return byVm;
}

async function capHoursForMeter(
	meter: Pick<BillingMeter, 'resourceType' | 'featureId' | 'resourceId'>
) {
	if (meter.resourceType !== 'vm') {
		return Number.POSITIVE_INFINITY;
	}

	const vmType = await vmTypeBilledByMeter(meter);
	return capHoursFor(vmType?.rate, vmType?.cap);
}

async function cappedPeriodAt(
	projectId: string,
	capHours: number,
	anchorFor: (projectId: string) => Promise<CapPeriod | null>
) {
	const anchor = Number.isFinite(capHours) ? await anchorFor(projectId) : null;
	return periodAtFor(anchor);
}

async function meterCapContext(meter: BillingMeter) {
	const capHours = await capHoursForMeter(meter);
	if (meter.resourceType === 'vm' && (await vmMeterIsUnbillable(meter))) {
		return { capHours, periodAt: periodAtFor(null), billable: false };
	}

	const lookup = await lookupProjectBillingPeriod(meter.projectId);
	if (lookup.customer === 'missing') {
		logUnbillableProject(meter.projectId);
		return { capHours, periodAt: periodAtFor(null), billable: false };
	}

	return { capHours, periodAt: periodAtFor(lookup.anchor), billable: true };
}

async function vmMeterIsUnbillable(meter: Pick<BillingMeter, 'resourceId'>) {
	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({
		where: eq(vms.id, meter.resourceId),
		columns: { status: true }
	});
	return vmIsUnbillable(vm?.status);
}

export async function hasUnsyncedUsageEvents(
	resourceType: BillingResourceType,
	resourceId: string
) {
	const db = initDrizzle();
	const pending = await db.query.billingUsageEvents.findFirst({
		where: and(
			eq(billingUsageEvents.resourceType, resourceType),
			eq(billingUsageEvents.resourceId, resourceId),
			inArray(billingUsageEvents.syncStatus, ['pending', 'failed'])
		),
		columns: { id: true }
	});
	return pending !== undefined;
}

function logUnbillableProject(projectId: string) {
	console.warn(
		`Project ${projectId} has no billing customer; skipping usage for its meters until one exists`
	);
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

	if (!meter) {
		return null;
	}

	const { capHours, periodAt, billable } = await meterCapContext(meter);

	const events = await settleMeter({
		meterId: meter.id,
		capHours,
		periodAt,
		billable,
		createdAt: now,
		windowEnd: (locked) => Math.max(now, locked.lastMeteredAt),
		meterUpdate: (state) => ({
			lastMeteredAt: now,
			...capStateColumns(state),
			active: false,
			endedAt: now
		})
	});

	let syncStatus: UsageSyncStatus | null = null;
	for (const event of events) {
		// biome-ignore lint/performance/noAwaitInLoops: usage events are pushed to Autumn in creation order, one at a time
		const [status] = await syncUsageEvents([event]);
		if (syncStatus !== 'failed') {
			syncStatus = status;
		}
	}

	return { events, syncStatus };
}

async function rotateMeterFeature(
	meter: BillingMeter,
	now: number,
	nextFeatureId: string,
	anchorFor: (projectId: string) => Promise<CapPeriod | null>
) {
	const capHours = await capHoursForMeter(meter);
	const periodAt = await cappedPeriodAt(meter.projectId, capHours, anchorFor);
	const closeAt = Math.max(now, meter.lastMeteredAt);

	console.error(
		`Billing meter ${meter.id} for VM ${meter.resourceId} changed feature ${meter.featureId} -> ${nextFeatureId}; closing out the old rate and restarting the cap`
	);

	return settleMeter({
		meterId: meter.id,
		capHours,
		periodAt,
		createdAt: closeAt,
		windowEnd: (locked) => (locked.featureId === meter.featureId ? closeAt : null),
		meterUpdate: () => ({
			featureId: nextFeatureId,
			lastMeteredAt: closeAt,
			capPeriodStart: null,
			capPeriodEnd: null,
			hoursThisPeriod: '0'
		})
	});
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

	if (orphans.length === 0) {
		return { closed: 0 };
	}

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
		.select({
			meter: billingMeters,
			currentFeatureId: vmTypes.autumnFeatureId
		})
		.from(billingMeters)
		.leftJoin(vms, eq(vms.id, billingMeters.resourceId))
		.leftJoin(vmTypes, eq(vmTypes.id, vms.vmTypeId))
		.where(
			and(
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.active, true),
				or(isNull(vms.status), notInArray(vms.status, unbillableVmStatuses)),
				or(
					lt(billingMeters.lastMeteredAt, now),
					and(
						isNotNull(vmTypes.autumnFeatureId),
						ne(vmTypes.autumnFeatureId, billingMeters.featureId)
					)
				)
			)
		)
		.orderBy(asc(billingMeters.lastMeteredAt))
		.limit(limit);

	const lookups = new Map<string, Promise<ProjectBillingPeriodLookup>>();
	const lookupFor = (projectId: string) => {
		let lookup = lookups.get(projectId);
		if (!lookup) {
			lookup = lookupBillingPeriodCreatingMissingCustomer(projectId);
			lookups.set(projectId, lookup);
		}
		return lookup;
	};
	const anchorFor = async (projectId: string) => {
		const lookup = await lookupFor(projectId);
		return lookup.customer === 'found' ? lookup.anchor : null;
	};

	let events = 0;
	const skipped = { unbillable: 0 };
	await runBounded(meters, METER_CONCURRENCY, async ({ meter, currentFeatureId }) => {
		const lookup = await lookupFor(meter.projectId);
		if (lookup.customer === 'missing') {
			skipped.unbillable += 1;
			return;
		}

		if (currentFeatureId && currentFeatureId !== meter.featureId) {
			const inserted = await rotateMeterFeature(meter, now, currentFeatureId, anchorFor);
			events += inserted.length;
			return;
		}

		const capHours = await capHoursForMeter(meter);
		const periodAt = await cappedPeriodAt(meter.projectId, capHours, anchorFor);
		const inserted = await recordMeterUsage(meter, now, capHours, periodAt);
		events += inserted.length;
	});

	return { meters: meters.length, events, skipped };
}

const unbillableVmStatuses: VmLifecycleStatus[] = ['error', 'deleting'];

function vmIsUnbillable(status: VmLifecycleStatus | null | undefined) {
	return status ? unbillableVmStatuses.includes(status) : false;
}

async function lookupBillingPeriodCreatingMissingCustomer(
	projectId: string
): Promise<ProjectBillingPeriodLookup> {
	const lookup = await lookupProjectBillingPeriod(projectId);
	if (lookup.customer === 'found') {
		return lookup;
	}

	try {
		await ensureProjectCustomer(projectId);
	} catch (err) {
		console.error(`Creating missing billing customer for project ${projectId} failed`, err);
		logUnbillableProject(projectId);
		return lookup;
	}

	const retried = await lookupProjectBillingPeriod(projectId);
	if (retried.customer === 'missing') {
		logUnbillableProject(projectId);
	}
	return retried;
}

type ProjectTargetStatus = { kind: 'ok' } | { kind: 'gone' } | { kind: 'failed'; reason: string };
type EventTargetStatus = 'ready' | 'failed' | 'abandoned';

interface EnsureCaches {
	entities: Map<string, Promise<string | null>>;
	projects: Map<string, Promise<ProjectTargetStatus>>;
}

const SYNC_CONCURRENCY = 6;
const METER_CONCURRENCY = 5;

async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
	let index = 0;
	const runner = async () => {
		while (index < items.length) {
			const item = items[index];
			index += 1;
			// biome-ignore lint/performance/noAwaitInLoops: each runner is one lane of a bounded worker pool and must finish an item before taking the next
			await worker(item);
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

	return !org || org.deletedAt !== null;
}

async function markUsageEventSynced(eventId: string) {
	const db = initDrizzle();
	await db
		.update(billingUsageEvents)
		.set({ syncStatus: 'synced', syncError: null, syncedAt: Date.now() })
		.where(eq(billingUsageEvents.id, eventId));
}

async function resolveProjectTargetStatus(projectId: string): Promise<ProjectTargetStatus> {
	try {
		await ensureProjectCustomer(projectId);
		return { kind: 'ok' };
	} catch (err) {
		const gone = await projectIsGone(projectId).catch(() => false);
		return gone ? { kind: 'gone' } : { kind: 'failed', reason: errorMessage(err) };
	}
}

function ensureProjectTarget(projectId: string, caches: EnsureCaches) {
	let ensured = caches.projects.get(projectId);
	if (!ensured) {
		ensured = resolveProjectTargetStatus(projectId);
		caches.projects.set(projectId, ensured);
	}

	return ensured;
}

function ensureEntityTarget(event: BillingUsageEvent, caches: EnsureCaches) {
	const db = initDrizzle();
	const entityKey = `${event.projectId}:${event.resourceId}`;
	let ensured = caches.entities.get(entityKey);
	if (!ensured) {
		ensured = (async () => {
			const vm = await db.query.vms.findFirst({
				where: eq(vms.id, event.resourceId),
				columns: { name: true }
			});
			await ensureServerEntity({
				projectId: event.projectId,
				serverId: event.resourceId,
				name: vm?.name
			});
			return null;
		})().catch((err) => errorMessage(err));
		caches.entities.set(entityKey, ensured);
	}

	return ensured;
}

async function ensureEventTarget(
	event: BillingUsageEvent,
	caches: EnsureCaches
): Promise<EventTargetStatus> {
	const customerStatus = await ensureProjectTarget(event.projectId, caches);
	if (customerStatus.kind === 'gone') {
		await markUsageEventAbandoned(event.id, 'Project no longer exists');
		return 'abandoned';
	}
	if (customerStatus.kind === 'failed') {
		await markUsageEventFailed(
			event.id,
			`Failed to ensure Autumn customer: ${customerStatus.reason}`
		);
		return 'failed';
	}

	if (event.resourceType === 'vm') {
		const entityFailure = await ensureEntityTarget(event, caches);
		if (entityFailure !== null) {
			await markUsageEventFailed(event.id, `Failed to ensure Autumn entity: ${entityFailure}`);
			return 'failed';
		}
	}

	return 'ready';
}

type UsageSyncStatus = 'synced' | 'failed' | 'abandoned';

const DUPLICATE_IDEMPOTENCY_KEY_CODE = 'duplicate_idempotency_key';

function isDuplicateIdempotencyKey(err: unknown) {
	if (autumnStatus(err) !== 409 || typeof err !== 'object' || err === null) {
		return false;
	}

	const body = 'body' in err && typeof err.body === 'string' ? err.body : '';
	return (
		body.includes(DUPLICATE_IDEMPOTENCY_KEY_CODE) ||
		errorMessage(err).includes(DUPLICATE_IDEMPOTENCY_KEY_CODE)
	);
}

async function trackUsageEvent(event: BillingUsageEvent): Promise<UsageSyncStatus> {
	if (!isBillingConfigured()) {
		await markUsageEventSynced(event.id);
		return 'synced';
	}

	try {
		await createAutumnClient().track(
			{
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
			},
			{ headers: { 'Idempotency-Key': event.idempotencyKey } }
		);
		await markUsageEventSynced(event.id);
		return 'synced';
	} catch (err) {
		if (autumnStatus(err) === 404) {
			await markUsageEventAbandoned(event.id, errorMessage(err));
			return 'abandoned';
		}
		if (isDuplicateIdempotencyKey(err)) {
			await markUsageEventSynced(event.id);
			return 'synced';
		}
		await markUsageEventFailed(event.id, errorMessage(err));
		return 'failed';
	}
}

export async function syncUsageEvents(events: BillingUsageEvent[]) {
	const caches: EnsureCaches = { projects: new Map(), entities: new Map() };
	const statuses: UsageSyncStatus[] = events.map(() => 'failed');
	const ready: number[] = [];

	await runBounded(
		events.map((event, index) => ({ event, index })),
		SYNC_CONCURRENCY,
		async ({ event, index }) => {
			if (event.syncStatus === 'synced') {
				statuses[index] = 'synced';
				return;
			}
			if (await isProjectBillingExempt(event.projectId)) {
				await markUsageEventSynced(event.id);
				statuses[index] = 'synced';
				return;
			}
			const target = await ensureEventTarget(event, caches);
			if (target === 'ready') {
				ready.push(index);
			} else {
				statuses[index] = target;
			}
		}
	);

	await runBounded(ready, SYNC_CONCURRENCY, async (index) => {
		statuses[index] = await trackUsageEvent(events[index]);
	});

	return statuses;
}

function countSyncStatuses(statuses: UsageSyncStatus[]) {
	const count = (status: UsageSyncStatus) => statuses.filter((item) => item === status).length;
	return { synced: count('synced'), failed: count('failed'), abandoned: count('abandoned') };
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

export async function syncPendingUsage(limit = 400) {
	const db = initDrizzle();
	const expired = await abandonStaleFailedEvents(Date.now());
	const events = await db
		.select()
		.from(billingUsageEvents)
		.where(inArray(billingUsageEvents.syncStatus, ['pending', 'failed']))
		.orderBy(asc(billingUsageEvents.createdAt))
		.limit(limit);

	const { synced, failed, abandoned } = countSyncStatuses(await syncUsageEvents(events));

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
		.orderBy(asc(billingUsageEvents.createdAt))
		.limit(limit);

	const { synced, failed, abandoned } = countSyncStatuses(await syncUsageEvents(events));

	return { attempted: events.length, synced, failed, abandoned };
}
