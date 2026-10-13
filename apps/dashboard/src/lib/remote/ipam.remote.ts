import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureIpamPrefixes
} from '#lib/server/accessibility-fixtures.js';
import { requireAdmin } from '#lib/server/auth-context.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { ipamAllocations, ipamPrefixes } from '#lib/server/db/schema.js';
import {
	ipamPrefixAddressingChanged,
	listIpamPrefixesWithStats,
	normalizeIpamPrefixInput
} from '#lib/server/ipam.js';
import { getIpamPtrDefaults, saveIpamPtrDefaults } from '#lib/server/ptr-records.js';
import { command, getRequestEvent, query } from '$app/server';

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return db;
}

export const listIpamPrefixes = query(async () => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureIpamPrefixes;
	}
	const db = await requireCurrentAdmin();
	return listIpamPrefixesWithStats(db);
});

type PrefixTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const prefixParams = type({
	name: 'string',
	cidr: 'string',
	whitelistStart: 'string?',
	whitelistEnd: 'string?',
	gatewayAddress: 'string?',
	bunnyDnsZone: 'string?',
	disabled: 'boolean?',
	ipv6UseTransitAddress: 'boolean?'
});

function uniqueOrExclusionViolation(err: unknown) {
	const code =
		typeof err === 'object' && err !== null && 'code' in err
			? (err as { code?: unknown }).code
			: (err as { cause?: { code?: unknown } } | null)?.cause?.code;
	return code === '23505' || code === '23P01';
}

async function lockPrefixAdmin(tx: PrefixTransaction) {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('ipam_prefixes_admin', 0))`);
}

async function assertNoOverlappingPrefix(
	tx: PrefixTransaction,
	cidr: string,
	excludePrefixId?: string
) {
	const overlapping = await tx
		.select({ cidr: ipamPrefixes.cidr })
		.from(ipamPrefixes)
		.where(
			and(
				sql`${ipamPrefixes.cidr} && ${cidr}::cidr`,
				excludePrefixId ? ne(ipamPrefixes.id, excludePrefixId) : undefined
			)
		)
		.limit(1);
	if (overlapping.length > 0) {
		error(409, `Prefix overlaps existing prefix ${overlapping[0].cidr}`);
	}
}

async function writePrefix<T>(run: () => Promise<T>) {
	try {
		return await run();
	} catch (err) {
		if (uniqueOrExclusionViolation(err)) {
			error(409, 'Prefix overlaps an existing prefix');
		}
		throw err;
	}
}

export const createIpamPrefix = command(prefixParams, async (params) => {
	const db = await requireCurrentAdmin();
	const normalized = normalizeIpamPrefixInput(params);

	if (!normalized.name) {
		error(400, 'Name is required');
	}

	return await writePrefix(() =>
		db.transaction(async (tx) => {
			await lockPrefixAdmin(tx);
			await assertNoOverlappingPrefix(tx, normalized.cidr);
			const [inserted] = await tx.insert(ipamPrefixes).values(normalized).returning();
			return inserted;
		})
	);
});

const updatePrefixParams = type({
	prefixId: 'string',
	name: 'string',
	cidr: 'string',
	whitelistStart: 'string?',
	whitelistEnd: 'string?',
	gatewayAddress: 'string?',
	bunnyDnsZone: 'string?',
	disabled: 'boolean?',
	ipv6UseTransitAddress: 'boolean?'
});

export const updateIpamPrefix = command(updatePrefixParams, async (params) => {
	const db = await requireCurrentAdmin();
	const normalized = normalizeIpamPrefixInput(params);
	if (!normalized.name) {
		error(400, 'Name is required');
	}

	return await writePrefix(() =>
		db.transaction(async (tx) => {
			await lockPrefixAdmin(tx);
			const [existing] = await tx
				.select()
				.from(ipamPrefixes)
				.where(eq(ipamPrefixes.id, params.prefixId))
				.for('update');
			if (!existing) {
				error(404, 'IPAM prefix not found');
			}

			if (ipamPrefixAddressingChanged(existing, normalized)) {
				const allocation = await tx.query.ipamAllocations.findFirst({
					where: eq(ipamAllocations.ipamPrefixId, params.prefixId),
					columns: { id: true }
				});
				if (allocation) {
					error(
						409,
						'Prefix range, gateway, whitelist, and IPv6 allocation mode cannot be changed with active allocations'
					);
				}
				await assertNoOverlappingPrefix(tx, normalized.cidr, params.prefixId);
			}

			const [updated] = await tx
				.update(ipamPrefixes)
				.set(normalized)
				.where(eq(ipamPrefixes.id, params.prefixId))
				.returning();

			return updated;
		})
	);
});

const disabledParams = type({ prefixId: 'string', disabled: 'boolean' });

export const setIpamPrefixDisabled = command(disabledParams, async (params) => {
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
});

const deleteParams = type({ prefixId: 'string' });

export const deleteIpamPrefix = command(deleteParams, async (params) => {
	const db = await requireCurrentAdmin();
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ id: ipamPrefixes.id })
			.from(ipamPrefixes)
			.where(eq(ipamPrefixes.id, params.prefixId))
			.for('update');
		if (!existing) {
			error(404, 'IPAM prefix not found');
		}

		const allocation = await tx.query.ipamAllocations.findFirst({
			where: eq(ipamAllocations.ipamPrefixId, params.prefixId),
			columns: { id: true }
		});
		if (allocation) {
			error(409, 'Prefixes with active allocations cannot be deleted');
		}

		await tx.delete(ipamPrefixes).where(eq(ipamPrefixes.id, params.prefixId));
	});
});

export const getIpamPtrDefaultFormats = query(async () => {
	if (accessibilityFixtureEnabled) {
		return { defaultPtrFormatIpv4: '', defaultPtrFormatIpv6: '' };
	}
	const db = await requireCurrentAdmin();
	return getIpamPtrDefaults(db);
});

const ptrDefaultsParams = type({
	defaultPtrFormatIpv4: 'string',
	defaultPtrFormatIpv6: 'string'
});

export const updateIpamPtrDefaultFormats = command(ptrDefaultsParams, async (params) => {
	const db = await requireCurrentAdmin();
	await saveIpamPtrDefaults(db, params);
	return getIpamPtrDefaults(db);
});
