import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { ipamAllocations, ipamPrefixes } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/auth-context';
import { listIpamPrefixesWithStats, normalizeIpamPrefixInput } from '$lib/server/ipam';

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

export const listIpamPrefixes = query(async () => {
	const db = await requireCurrentAdmin();
	return listIpamPrefixesWithStats(db);
});

const prefixParams = type({
	name: 'string',
	cidr: 'string',
	whitelistStart: 'string?',
	whitelistEnd: 'string?',
	gatewayAddress: 'string?',
	disabled: 'boolean?',
	ipv6UseTransitAddress: 'boolean?'
});

export const createIpamPrefix = command(prefixParams, async (params) => {
	const db = await requireCurrentAdmin();
	const normalized = normalizeIpamPrefixInput(params);

	if (!normalized.name) error(400, 'Name is required');

	const [inserted] = await db.insert(ipamPrefixes).values(normalized).returning();
	return inserted;
});

const updatePrefixParams = type({
	prefixId: 'string',
	name: 'string',
	cidr: 'string',
	whitelistStart: 'string?',
	whitelistEnd: 'string?',
	gatewayAddress: 'string?',
	disabled: 'boolean?',
	ipv6UseTransitAddress: 'boolean?'
});

export const updateIpamPrefix = command(updatePrefixParams, async (params) => {
	const db = await requireCurrentAdmin();
	const existing = await db.query.ipamPrefixes.findFirst({
		where: eq(ipamPrefixes.id, params.prefixId)
	});
	if (!existing) error(404, 'IPAM prefix not found');

	const normalized = normalizeIpamPrefixInput(params);
	if (!normalized.name) error(400, 'Name is required');

	if (existing.ipv6UseTransitAddress !== normalized.ipv6UseTransitAddress) {
		const allocation = await db.query.ipamAllocations.findFirst({
			where: eq(ipamAllocations.ipamPrefixId, params.prefixId)
		});
		if (allocation) error(400, 'IPv6 allocation mode cannot be changed with active allocations');
	}

	const [updated] = await db
		.update(ipamPrefixes)
		.set(normalized)
		.where(eq(ipamPrefixes.id, params.prefixId))
		.returning();

	return updated;
});

const disabledParams = type({ prefixId: 'string', disabled: 'boolean' });

export const setIpamPrefixDisabled = command(disabledParams, async (params) => {
	const db = await requireCurrentAdmin();
	const [updated] = await db
		.update(ipamPrefixes)
		.set({ disabled: params.disabled })
		.where(eq(ipamPrefixes.id, params.prefixId))
		.returning();

	if (!updated) error(404, 'IPAM prefix not found');
	return updated;
});

const deleteParams = type({ prefixId: 'string' });

export const deleteIpamPrefix = command(deleteParams, async (params) => {
	const db = await requireCurrentAdmin();
	const existing = await db.query.ipamPrefixes.findFirst({
		where: eq(ipamPrefixes.id, params.prefixId)
	});
	if (!existing) error(404, 'IPAM prefix not found');

	const allocation = await db.query.ipamAllocations.findFirst({
		where: eq(ipamAllocations.ipamPrefixId, params.prefixId)
	});
	if (allocation) error(400, 'Prefixes with active allocations cannot be deleted');

	await db.delete(ipamPrefixes).where(eq(ipamPrefixes.id, params.prefixId));
});
