import { eq } from 'drizzle-orm';
import { requireAdmin } from '#lib/server/auth-context.js';
import { context } from '#lib/server/context.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { ipamAllocations, ipamPrefixes } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { listIpamPrefixesWithStats, normalizeIpamPrefixInput } from '#lib/server/ipam.js';
import { getIpamPtrDefaults, saveIpamPtrDefaults } from '#lib/server/ptr-records.js';

export interface CreateIpamPrefixInput {
	bunnyDnsZone?: string;
	cidr: string;
	disabled?: boolean;
	gatewayAddress?: string;
	ipv6UseTransitAddress?: boolean;
	name: string;
	whitelistEnd?: string;
	whitelistStart?: string;
}

export interface UpdateIpamPrefixInput extends CreateIpamPrefixInput {
	prefixId: string;
}

export interface SetIpamPrefixDisabledInput {
	disabled: boolean;
	prefixId: string;
}

export interface DeleteIpamPrefixInput {
	prefixId: string;
}

export interface UpdateIpamPtrDefaultFormatsInput {
	defaultPtrFormatIpv4: string;
	defaultPtrFormatIpv6: string;
}

async function requireCurrentAdmin() {
	const { locals } = context();
	if (!locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, locals.user.id);

	return db;
}

export async function listIpamPrefixes() {
	const db = await requireCurrentAdmin();
	return listIpamPrefixesWithStats(db);
}

export async function createIpamPrefix(params: CreateIpamPrefixInput) {
	const db = await requireCurrentAdmin();
	const normalized = normalizeIpamPrefixInput(params);

	if (!normalized.name) {
		error(400, 'Name is required');
	}

	const [inserted] = await db.insert(ipamPrefixes).values(normalized).returning();
	return inserted;
}

export async function updateIpamPrefix(params: UpdateIpamPrefixInput) {
	const db = await requireCurrentAdmin();
	const existing = await db.query.ipamPrefixes.findFirst({
		where: eq(ipamPrefixes.id, params.prefixId)
	});
	if (!existing) {
		error(404, 'IPAM prefix not found');
	}

	const normalized = normalizeIpamPrefixInput(params);
	if (!normalized.name) {
		error(400, 'Name is required');
	}

	if (existing.ipv6UseTransitAddress !== normalized.ipv6UseTransitAddress) {
		const allocation = await db.query.ipamAllocations.findFirst({
			where: eq(ipamAllocations.ipamPrefixId, params.prefixId)
		});
		if (allocation) {
			error(400, 'IPv6 allocation mode cannot be changed with active allocations');
		}
	}

	const [updated] = await db
		.update(ipamPrefixes)
		.set(normalized)
		.where(eq(ipamPrefixes.id, params.prefixId))
		.returning();

	return updated;
}

export async function setIpamPrefixDisabled(params: SetIpamPrefixDisabledInput) {
	const db = await requireCurrentAdmin();
	const [updated] = await db
		.update(ipamPrefixes)
		.set({ disabled: params.disabled })
		.where(eq(ipamPrefixes.id, params.prefixId))
		.returning();

	if (!updated) {
		error(404, 'IPAM prefix not found');
	}
	return updated;
}

export async function deleteIpamPrefix(params: DeleteIpamPrefixInput) {
	const db = await requireCurrentAdmin();
	const existing = await db.query.ipamPrefixes.findFirst({
		where: eq(ipamPrefixes.id, params.prefixId)
	});
	if (!existing) {
		error(404, 'IPAM prefix not found');
	}

	const allocation = await db.query.ipamAllocations.findFirst({
		where: eq(ipamAllocations.ipamPrefixId, params.prefixId)
	});
	if (allocation) {
		error(400, 'Prefixes with active allocations cannot be deleted');
	}

	await db.delete(ipamPrefixes).where(eq(ipamPrefixes.id, params.prefixId));
}

export async function getIpamPtrDefaultFormats() {
	const db = await requireCurrentAdmin();
	return getIpamPtrDefaults(db);
}

export async function updateIpamPtrDefaultFormats(params: UpdateIpamPtrDefaultFormatsInput) {
	const db = await requireCurrentAdmin();
	await saveIpamPtrDefaults(db, params);
	return getIpamPtrDefaults(db);
}
