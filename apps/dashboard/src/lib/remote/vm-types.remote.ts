import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureVmTypes
} from '#lib/server/accessibility-fixtures.js';
import { requireAdmin } from '#lib/server/auth-context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { vmTypes } from '#lib/server/db/schema.js';
import { command, getRequestEvent, query } from '$app/server';

export const listVmTypes = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureVmTypes;
	}

	const db = initDrizzle();
	const rows = await db.query.vmTypes.findMany({
		orderBy: [asc(vmTypes.sortOrder), asc(vmTypes.id)]
	});
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		isa: row.isa,
		cores: row.cores,
		ramCapacity: row.ramCapacity,
		storageAmount: row.storageAmount,
		rate: row.rate,
		cap: row.cap,
		autumnFeatureId: row.autumnFeatureId
	}));
});

const createParams = type({
	name: 'string',
	isa: "'x86'",
	cores: 'number',
	ramCapacity: 'number',
	storageAmount: 'number',
	rate: 'string',
	cap: 'string',
	autumnFeatureId: 'string'
});
export const createVmType = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const inserted = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vm_types_sort_order'))`);
		const [{ nextSortOrder }] = await tx
			.select({ nextSortOrder: sql<number>`coalesce(max(${vmTypes.sortOrder}), -1)::int + 1` })
			.from(vmTypes);

		const [row] = await tx
			.insert(vmTypes)
			.values({
				sortOrder: nextSortOrder,
				name: params.name,
				isa: params.isa,
				cores: params.cores,
				ramCapacity: params.ramCapacity,
				storageAmount: params.storageAmount,
				rate: params.rate,
				cap: params.cap,
				autumnFeatureId: params.autumnFeatureId.trim() || null
			})
			.onConflictDoNothing({ target: vmTypes.name })
			.returning({ id: vmTypes.id });
		return row;
	});

	if (!inserted) {
		error(409, `A VM type named "${params.name}" already exists`);
	}

	return { id: inserted.id };
});

const updateParams = type({
	vmTypeId: 'string',
	name: 'string?',
	isa: "'x86'?",
	cores: 'number?',
	ramCapacity: 'number?',
	storageAmount: 'number?',
	rate: 'string?',
	cap: 'string?',
	autumnFeatureId: 'string?'
});
export const updateVmType = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!existing) {
		error(404, 'VM type not found');
	}

	if (params.name !== undefined) {
		const [duplicate] = await db
			.select({ id: vmTypes.id })
			.from(vmTypes)
			.where(and(eq(vmTypes.name, params.name), ne(vmTypes.id, params.vmTypeId)))
			.limit(1);
		if (duplicate) {
			error(409, `A VM type named "${params.name}" already exists`);
		}
	}

	const { vmTypeId, ...fields } = params;
	const updates = Object.fromEntries(
		Object.entries(fields)
			.filter(([, v]) => v !== undefined)
			.map(([key, value]) => [
				key,
				key === 'autumnFeatureId' ? String(value).trim() || null : value
			])
	);
	if (Object.keys(updates).length === 0) {
		return;
	}

	await db.update(vmTypes).set(updates).where(eq(vmTypes.id, params.vmTypeId));
});

const reorderParams = type({ vmTypeIds: 'string[]' });
export const reorderVmTypes = command(reorderParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const rows = await db.query.vmTypes.findMany({ columns: { id: true } });
	const existingIds = new Set(rows.map((row) => row.id));
	const requestedIds = new Set(params.vmTypeIds);
	if (
		params.vmTypeIds.length !== existingIds.size ||
		requestedIds.size !== existingIds.size ||
		params.vmTypeIds.some((id) => !existingIds.has(id))
	) {
		error(400, 'VM type order is out of date, refresh and try again');
	}

	await Promise.all(
		params.vmTypeIds.map((id, index) =>
			db.update(vmTypes).set({ sortOrder: index }).where(eq(vmTypes.id, id))
		)
	);
});

const deleteParams = type({ vmTypeId: 'string' });
export const deleteVmType = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!existing) {
		error(404, 'VM type not found');
	}

	try {
		await db.delete(vmTypes).where(eq(vmTypes.id, params.vmTypeId));
	} catch {
		error(409, 'Cannot delete a VM type that is in use by existing VMs');
	}
});
