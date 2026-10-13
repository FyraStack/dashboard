import { error } from '@sveltejs/kit';
import { eq, inArray, sql } from 'drizzle-orm';
import {
	addressInCidr,
	applyPtrTemplate,
	isValidPtrHostname,
	reverseDnsNameForIp,
	sameAddress
} from '#lib/ptr.js';
import {
	BunnyClient,
	BunnyError,
	bunnyDnsRecordTypePtr,
	isBunnyConfigured
} from '#lib/server/bunny.js';
import type { initDrizzle } from '#lib/server/db/index.js';
import { ipamPtrRecords, ipamSettings } from '#lib/server/db/schema.js';

type Db = ReturnType<typeof initDrizzle>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type QueryableDb = Db | Transaction;

export interface PtrAllocation {
	address: string | null;
	family: 'ipv4' | 'ipv6';
	id: string;
	prefix: string | null;
	sourcePrefix: { bunnyDnsZone: string | null };
}

export interface IpamPtrDefaults {
	defaultPtrFormatIpv4: string;
	defaultPtrFormatIpv6: string;
}

const settingsRowId = 'default';
const TRAILING_DOT = /\.$/;

export async function getIpamPtrDefaults(db: QueryableDb): Promise<IpamPtrDefaults> {
	const row = await db.query.ipamSettings.findFirst({
		where: eq(ipamSettings.id, settingsRowId)
	});

	return {
		defaultPtrFormatIpv4: row?.defaultPtrFormatIpv4 ?? '',
		defaultPtrFormatIpv6: row?.defaultPtrFormatIpv6 ?? ''
	};
}

export async function saveIpamPtrDefaults(db: QueryableDb, defaults: IpamPtrDefaults) {
	const values = {
		id: settingsRowId,
		defaultPtrFormatIpv4: defaults.defaultPtrFormatIpv4.trim() || null,
		defaultPtrFormatIpv6: defaults.defaultPtrFormatIpv6.trim() || null
	};

	await db
		.insert(ipamSettings)
		.values(values)
		.onConflictDoUpdate({
			target: ipamSettings.id,
			set: {
				defaultPtrFormatIpv4: values.defaultPtrFormatIpv4,
				defaultPtrFormatIpv6: values.defaultPtrFormatIpv6
			}
		});
}

function allocationCoversAddress(allocation: PtrAllocation, address: string) {
	if (allocation.address) {
		return sameAddress(address, allocation.address);
	}
	if (allocation.prefix) {
		return addressInCidr(address, allocation.prefix);
	}
	return false;
}

function ptrRecordName(address: string, zone: string) {
	const reverseName = reverseDnsNameForIp(address);
	if (!reverseName) {
		return null;
	}

	const suffix = `.${zone.toLowerCase()}`;
	if (!reverseName.endsWith(suffix)) {
		return null;
	}

	return reverseName.slice(0, -suffix.length);
}

async function resolveZone(client: BunnyClient, allocation: PtrAllocation, address: string) {
	const zoneDomain = allocation.sourcePrefix.bunnyDnsZone;
	if (!zoneDomain) {
		error(400, 'This IP block has no Bunny DNS zone configured');
	}

	const recordName = ptrRecordName(address, zoneDomain);
	if (recordName === null) {
		error(400, `${address} is outside the configured DNS zone ${zoneDomain}`);
	}

	const zone = await client.findDnsZone(zoneDomain);
	if (!zone) {
		error(400, `DNS zone ${zoneDomain} was not found in Bunny.net`);
	}

	return { zone, recordName };
}

async function lockPtrAddress(db: QueryableDb, address: string) {
	await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended('ipam_ptr:' || host(${address}::inet), 0))`
	);
}

async function reusableBunnyRecordId(client: BunnyClient, zoneId: number, recordName: string) {
	const name = recordName.toLowerCase();
	const [keep, ...duplicates] = (await client.listRecords(zoneId)).filter(
		(record) => record.Type === bunnyDnsRecordTypePtr && record.Name.toLowerCase() === name
	);
	for (const duplicate of duplicates) {
		// biome-ignore lint/performance/noAwaitInLoops: Bunny DNS deletes are sent one at a time to stay within its rate limits
		await client.deleteRecord(zoneId, duplicate.Id).catch((err) => {
			console.warn(`Failed to delete duplicate Bunny PTR record ${duplicate.Id}`, err);
		});
	}

	return keep?.Id ?? null;
}

async function updateExistingBunnyRecord(
	client: BunnyClient,
	zoneId: number,
	recordId: number,
	recordName: string,
	value: string
) {
	try {
		await client.updatePtrRecord(zoneId, recordId, recordName, value);
		return recordId;
	} catch (err) {
		if (err instanceof BunnyError && err.status === 404) {
			return null;
		}
		throw err;
	}
}

export async function setPtrRecord(
	db: QueryableDb,
	allocation: PtrAllocation,
	rawAddress: string,
	rawValue: string
) {
	const address = rawAddress.trim();
	if (!allocationCoversAddress(allocation, address)) {
		error(400, `${address} is not part of this allocation`);
	}

	const value = rawValue.trim().replace(TRAILING_DOT, '').toLowerCase();
	if (!value) {
		return clearPtrRecord(db, allocation, address);
	}

	if (!isValidPtrHostname(value)) {
		error(400, 'Reverse DNS must be a valid hostname');
	}
	if (!isBunnyConfigured()) {
		error(503, 'Reverse DNS management is not configured');
	}

	const client = new BunnyClient();
	const { zone, recordName } = await resolveZone(client, allocation, address);

	return await db.transaction(async (tx) => {
		await lockPtrAddress(tx, address);

		const existing = await tx.query.ipamPtrRecords.findFirst({
			where: eq(ipamPtrRecords.address, address)
		});
		if (existing && existing.ipamAllocationId !== allocation.id) {
			error(409, `${address} already has a reverse DNS record on another allocation`);
		}

		const existingRecordId = existing?.bunnyRecordId ?? null;
		let bunnyRecordId =
			existingRecordId === null
				? null
				: await updateExistingBunnyRecord(client, zone.Id, existingRecordId, recordName, value);
		if (bunnyRecordId === null) {
			const reusable = await reusableBunnyRecordId(client, zone.Id, recordName);
			bunnyRecordId =
				reusable === null
					? null
					: await updateExistingBunnyRecord(client, zone.Id, reusable, recordName, value);
		}
		let createdRecordId: number | null = null;
		if (bunnyRecordId === null) {
			const created = await client.createPtrRecord(zone.Id, recordName, value);
			bunnyRecordId = created.Id;
			createdRecordId = created.Id;
		}

		try {
			const [row] = await tx
				.insert(ipamPtrRecords)
				.values({ ipamAllocationId: allocation.id, address, value, bunnyRecordId })
				.onConflictDoUpdate({
					target: ipamPtrRecords.address,
					set: { value, bunnyRecordId }
				})
				.returning();

			return { address: row.address, value: row.value };
		} catch (err) {
			if (createdRecordId !== null) {
				await client.deleteRecord(zone.Id, createdRecordId).catch((cleanupErr) => {
					console.warn(`Failed to roll back Bunny PTR record for ${address}`, cleanupErr);
				});
			}
			throw err;
		}
	});
}

export async function clearPtrRecord(db: QueryableDb, allocation: PtrAllocation, address: string) {
	return await db.transaction(async (tx) => {
		await lockPtrAddress(tx, address);

		const existing = await tx.query.ipamPtrRecords.findFirst({
			where: eq(ipamPtrRecords.address, address)
		});
		if (!existing || existing.ipamAllocationId !== allocation.id) {
			return null;
		}

		if (existing.bunnyRecordId !== null && isBunnyConfigured()) {
			const zoneDomain = allocation.sourcePrefix.bunnyDnsZone;
			if (zoneDomain) {
				const client = new BunnyClient();
				const zone = await client.findDnsZone(zoneDomain);
				if (zone) {
					await client.deleteRecord(zone.Id, existing.bunnyRecordId);
				}
			}
		}

		await tx.delete(ipamPtrRecords).where(eq(ipamPtrRecords.id, existing.id));
		return null;
	});
}

export async function applyDefaultPtrRecords(db: QueryableDb, allocations: PtrAllocation[]) {
	if (!isBunnyConfigured()) {
		return;
	}

	const defaults = await getIpamPtrDefaults(db);

	for (const allocation of allocations) {
		if (!(allocation.address && allocation.sourcePrefix.bunnyDnsZone)) {
			continue;
		}

		const format =
			allocation.family === 'ipv4' ? defaults.defaultPtrFormatIpv4 : defaults.defaultPtrFormatIpv6;
		if (!format) {
			continue;
		}

		const value = applyPtrTemplate(format, allocation.address);
		if (!value) {
			console.warn(
				`Default PTR format for ${allocation.family} produced an invalid hostname for ${allocation.address}`
			);
			continue;
		}

		try {
			// biome-ignore lint/performance/noAwaitInLoops: db may be a transaction, which cannot run queries concurrently, and Bunny writes are paced one at a time
			await setPtrRecord(db, allocation, allocation.address, value);
		} catch (err) {
			console.warn(`Failed to apply default PTR record for ${allocation.address}`, err);
		}
	}
}

export async function deletePtrRecords(db: QueryableDb, allocations: PtrAllocation[]) {
	if (allocations.length === 0) {
		return;
	}

	const rows = await db.query.ipamPtrRecords.findMany({
		where: inArray(
			ipamPtrRecords.ipamAllocationId,
			allocations.map((allocation) => allocation.id)
		)
	});
	if (rows.length === 0) {
		return;
	}

	if (isBunnyConfigured()) {
		const zonesByAllocation = new Map(
			allocations.map((allocation) => [allocation.id, allocation.sourcePrefix.bunnyDnsZone])
		);
		const client = new BunnyClient();
		for (const row of rows) {
			if (row.bunnyRecordId === null) {
				continue;
			}
			const zoneDomain = zonesByAllocation.get(row.ipamAllocationId);
			if (!zoneDomain) {
				continue;
			}

			try {
				// biome-ignore lint/performance/noAwaitInLoops: Bunny DNS deletes are sent one at a time to stay within its rate limits
				const zone = await client.findDnsZone(zoneDomain);
				if (zone) {
					await client.deleteRecord(zone.Id, row.bunnyRecordId);
				}
			} catch (err) {
				console.warn(`Failed to delete PTR record for ${row.address}`, err);
			}
		}
	}

	await db.delete(ipamPtrRecords).where(
		inArray(
			ipamPtrRecords.id,
			rows.map((row) => row.id)
		)
	);
}
