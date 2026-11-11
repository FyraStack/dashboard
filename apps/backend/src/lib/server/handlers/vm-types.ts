import { asc, desc, eq } from 'drizzle-orm';
import type { defaultIsa } from 'stack-shared/compute';
import { requireAdminUser, requireUser } from '#lib/server/auth-context.js';
import { vmTypes } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';

export interface CreateVmTypeInput {
	autumnFeatureId: string;
	cap: string;
	cores: number;
	isa: typeof defaultIsa;
	name: string;
	ramCapacity: number;
	rate: string;
	storageAmount: number;
}

export interface UpdateVmTypeInput extends Partial<CreateVmTypeInput> {
	vmTypeId: string;
}

export interface ReorderVmTypesInput {
	vmTypeIds: string[];
}

export interface DeleteVmTypeInput {
	vmTypeId: string;
}

function normalizeAutumnFeatureId(value: string) {
	return value.trim() || null;
}

export async function listVmTypes() {
	const { db } = requireUser();
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
}

export async function createVmType(params: CreateVmTypeInput) {
	const { db } = await requireAdminUser();

	const lastVmType = await db.query.vmTypes.findFirst({
		orderBy: [desc(vmTypes.sortOrder)]
	});

	const [inserted] = await db
		.insert(vmTypes)
		.values({
			sortOrder: (lastVmType?.sortOrder ?? -1) + 1,
			name: params.name,
			isa: params.isa,
			cores: params.cores,
			ramCapacity: params.ramCapacity,
			storageAmount: params.storageAmount,
			rate: params.rate,
			cap: params.cap,
			autumnFeatureId: normalizeAutumnFeatureId(params.autumnFeatureId)
		})
		.returning();

	return { id: inserted.id };
}

export async function updateVmType(params: UpdateVmTypeInput) {
	const { db } = await requireAdminUser();

	const existing = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!existing) {
		error(404, 'VM type not found');
	}

	const { vmTypeId, autumnFeatureId, ...fields } = params;
	const updates = {
		...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
		...(autumnFeatureId === undefined
			? {}
			: { autumnFeatureId: normalizeAutumnFeatureId(autumnFeatureId) })
	};
	if (Object.keys(updates).length === 0) {
		return;
	}

	await db.update(vmTypes).set(updates).where(eq(vmTypes.id, params.vmTypeId));
}

export async function reorderVmTypes(params: ReorderVmTypesInput) {
	const { db } = await requireAdminUser();

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
}

export async function deleteVmType(params: DeleteVmTypeInput) {
	const { db } = await requireAdminUser();

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
}
