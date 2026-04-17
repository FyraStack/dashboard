import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { vmTypes } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/rpc/context';

type VmTypeRow = {
	id: string;
	name: string;
	isa: string;
	cores: number;
	ramCapacity: number;
	storageAmount: number;
	rate: string;
	cap: string;
};

export const listVmTypes = query(type({}), async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	return db.query.vmTypes.findMany();
});

const createParams = type({
	name: 'string',
	isa: "'x86' | 'arm' | 'risc-v'",
	cores: 'number',
	ramCapacity: 'number',
	storageAmount: 'number',
	price: 'string'
});
export const createVmType = command(createParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const [inserted] = await db
		.insert(vmTypes)
		.values({
			name: params.name,
			isa: params.isa,
			cores: params.cores,
			ramCapacity: params.ramCapacity,
			storageAmount: params.storageAmount,
			rate: params.price,
			cap: ''
		})
		.returning();

	return { id: inserted.id };
});

const updateParams = type({
	vmTypeId: 'string',
	name: 'string?',
	cores: 'number?',
	ramCapacity: 'number?',
	storageAmount: 'number?',
	price: 'string?'
});
export const updateVmType = command(updateParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!existing) error(404, 'VM type not found');

	const updates: Record<string, unknown> = {};
	if (params.name !== undefined) updates.name = params.name;
	if (params.cores !== undefined) updates.cores = params.cores;
	if (params.ramCapacity !== undefined) updates.ramCapacity = params.ramCapacity;
	if (params.storageAmount !== undefined) updates.storageAmount = params.storageAmount;
	if (params.price !== undefined) updates.rate = params.price;

	const keys = Object.keys(updates);
	if (keys.length === 0) return;

	await db.update(vmTypes).set(updates).where(eq(vmTypes.id, params.vmTypeId));
});

const deleteParams = type({ vmTypeId: 'string' });
export const deleteVmType = command(deleteParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	const existing = await db.query.vmTypes.findFirst({
		where: eq(vmTypes.id, params.vmTypeId)
	});
	if (!existing) error(404, 'VM type not found');

	try {
		await db.delete(vmTypes).where(eq(vmTypes.id, params.vmTypeId));
	} catch {
		error(409, 'Cannot delete a VM type that is in use by existing VMs');
	}
});
