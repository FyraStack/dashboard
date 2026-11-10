import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { Address4, Address6 } from 'ip-address';
import type { NetworkingMode } from 'stack-shared/compute';
import { isValidPtrHostname } from 'stack-shared/ptr';
import type { initDrizzle } from '#lib/server/db/index.js';
import { ipamAllocations, ipamPrefixes, vms } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { deletePtrRecords } from '#lib/server/ptr-records.js';
import { isVyosConfigured, VyosClient } from '#lib/server/vyos.js';

type IpFamily = 'ipv4' | 'ipv6';

type Db = ReturnType<typeof initDrizzle>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type QueryableDb = Db | Transaction;

type IpamPrefix = typeof ipamPrefixes.$inferSelect;
type IpamAllocation = typeof ipamAllocations.$inferSelect;

export interface IpamPrefixInput {
	bunnyDnsZone?: string | null;
	cidr: string;
	disabled?: boolean;
	gatewayAddress?: string | null;
	ipv6UseTransitAddress?: boolean;
	name: string;
	whitelistEnd?: string | null;
	whitelistStart?: string | null;
}

type IpamPrefixWithStats = IpamPrefix & {
	allocated: number;
	capacity: string;
	available: string;
	hasCapacity: boolean;
};

interface IpamAvailability {
	ipv4: { available: boolean; availableCount: string };
	ipv6: { available: boolean; availableCount: string };
}

interface AddressRange {
	end: bigint;
	family: IpFamily;
	prefixLength: number;
	start: bigint;
}

type PendingAllocation = IpamAllocation & {
	sourcePrefix: IpamPrefix;
};

type AllocationKind = 'ipv4' | 'ipv6-transit' | 'ipv6-prefix';

type KindedAllocation = Pick<IpamAllocation, 'family' | 'address' | 'prefix'>;

export function findIpv4Allocation<T extends KindedAllocation>(allocations: T[]) {
	return allocations.find((allocation) => allocation.family === 'ipv4' && allocation.address);
}

export function findIpv6TransitAllocation<T extends KindedAllocation>(allocations: T[]) {
	return allocations.find((allocation) => allocation.family === 'ipv6' && allocation.address);
}

export function findIpv6PrefixAllocation<T extends KindedAllocation>(allocations: T[]) {
	return allocations.find((allocation) => allocation.family === 'ipv6' && allocation.prefix);
}

const v6Bits = 128;
const vmIpv4PrefixLength = 32;
const vmIpv6PrefixLength = 64;
const randomAllocationAttempts = 25;
const sequentialAllocationAttempts = 5;
const MAX_SEQUENTIAL_IPV6_SLOTS = 1_000_000n;
const TRAILING_DOT = /\.$/;
const allocationKindLabels: Record<AllocationKind, string> = {
	ipv4: 'IPv4 addresses',
	'ipv6-transit': 'IPv6 transit addresses',
	'ipv6-prefix': 'IPv6 prefixes'
};

const UNIQUE_VIOLATION_CODE = '23505';

function uniqueViolation(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) {
		return false;
	}
	if ('code' in err && err.code === UNIQUE_VIOLATION_CODE) {
		return true;
	}
	return 'cause' in err && uniqueViolation(err.cause);
}

export function generateMacAddress() {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	bytes[0] = (bytes[0] & 0xfe) | 0x02;

	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function parseCidr(cidr: string): AddressRange {
	if (Address4.isValid(cidr)) {
		const address = new Address4(cidr);
		return {
			family: 'ipv4',
			start: address.startAddress().bigInt(),
			end: address.endAddress().bigInt(),
			prefixLength: address.subnetMask
		};
	}

	if (Address6.isValid(cidr)) {
		const address = new Address6(cidr);
		return {
			family: 'ipv6',
			start: address.startAddress().bigInt(),
			end: address.endAddress().bigInt(),
			prefixLength: address.subnetMask
		};
	}

	error(400, `Invalid IP prefix "${cidr}"`);
}

function normalizeCidr(cidr: string) {
	if (Address4.isValid(cidr)) {
		const address = new Address4(cidr);
		return {
			cidr: address.networkForm(),
			family: 'ipv4' as const,
			prefixLength: address.subnetMask
		};
	}

	if (Address6.isValid(cidr)) {
		const address = new Address6(cidr);
		return {
			cidr: address.networkForm(),
			family: 'ipv6' as const,
			prefixLength: address.subnetMask
		};
	}

	error(400, `Invalid IP prefix "${cidr}"`);
}

function parseAddress(family: IpFamily, value: string) {
	if (family === 'ipv4') {
		if (!Address4.isValid(value)) {
			error(400, `Invalid IPv4 address "${value}"`);
		}
		return new Address4(value).bigInt();
	}

	if (!Address6.isValid(value)) {
		error(400, `Invalid IPv6 address "${value}"`);
	}
	return new Address6(value).bigInt();
}

function formatAddress(family: IpFamily, value: bigint) {
	return family === 'ipv4'
		? Address4.fromBigInt(value).correctForm()
		: Address6.fromBigInt(value).correctForm();
}

function formatPrefix(family: IpFamily, value: bigint, prefixLength: number) {
	return `${formatAddress(family, value)}/${prefixLength}`;
}

function ipv4UsableRange(range: AddressRange) {
	const excludesNetworkAndBroadcast = range.prefixLength < 31;
	return {
		first: range.start + (excludesNetworkAndBroadcast ? 1n : 0n),
		last: range.end - (excludesNetworkAndBroadcast ? 1n : 0n)
	};
}

function defaultWhitelistBounds(range: AddressRange) {
	if (range.family === 'ipv4') {
		return ipv4UsableRange(range);
	}

	return {
		first: range.start < range.end ? range.start + 1n : range.start,
		last: range.end
	};
}

function vmPrefixLengthFor(family: IpFamily, ipv6UseTransitAddress: boolean) {
	if (family === 'ipv4') {
		return vmIpv4PrefixLength;
	}
	return ipv6UseTransitAddress ? v6Bits : vmIpv6PrefixLength;
}

function normalizeGatewayAddress(
	family: IpFamily,
	range: AddressRange,
	rawGatewayAddress: string | null | undefined
) {
	if (family !== 'ipv4') {
		return null;
	}

	const gatewayAddress = rawGatewayAddress?.trim() || null;
	if (!gatewayAddress) {
		error(400, 'Gateway address is required for IPv4 prefixes');
	}
	const gatewayValue = parseAddress('ipv4', gatewayAddress);
	if (gatewayValue < range.start || gatewayValue > range.end) {
		error(400, 'Gateway address must be inside the prefix');
	}
	return formatAddress('ipv4', gatewayValue);
}

function normalizeWhitelist(
	family: IpFamily,
	range: AddressRange,
	rawStart: string | null | undefined,
	rawEnd: string | null | undefined
) {
	const whitelistStart = rawStart?.trim() || null;
	const whitelistEnd = rawEnd?.trim() || null;
	if (!(whitelistStart || whitelistEnd)) {
		return { whitelistStart, whitelistEnd };
	}

	const defaults = defaultWhitelistBounds(range);
	const startValue = whitelistStart ? parseAddress(family, whitelistStart) : defaults.first;
	const endValue = whitelistEnd ? parseAddress(family, whitelistEnd) : defaults.last;
	if (startValue < range.start || startValue > range.end) {
		error(400, 'Whitelist start must be inside the prefix');
	}
	if (endValue < range.start || endValue > range.end) {
		error(400, 'Whitelist end must be inside the prefix');
	}
	if (startValue > endValue) {
		error(400, 'Whitelist start must be <= whitelist end');
	}

	return {
		whitelistStart: formatAddress(family, startValue),
		whitelistEnd: formatAddress(family, endValue)
	};
}

export function normalizeIpamPrefixInput(input: IpamPrefixInput) {
	const normalized = normalizeCidr(input.cidr.trim());
	const ipv6UseTransitAddress =
		normalized.family === 'ipv6' && (input.ipv6UseTransitAddress ?? false);
	const vmPrefixLength = vmPrefixLengthFor(normalized.family, ipv6UseTransitAddress);
	if (normalized.prefixLength > vmPrefixLength) {
		error(400, `${normalized.family} prefix is too small for VM allocations`);
	}

	const range = parseCidr(normalized.cidr);
	const gatewayAddress = normalizeGatewayAddress(normalized.family, range, input.gatewayAddress);
	const { whitelistStart, whitelistEnd } = normalizeWhitelist(
		normalized.family,
		range,
		input.whitelistStart,
		input.whitelistEnd
	);

	const bunnyDnsZone = input.bunnyDnsZone?.trim().replace(TRAILING_DOT, '').toLowerCase() || null;
	if (bunnyDnsZone && !isValidPtrHostname(bunnyDnsZone)) {
		error(400, 'Bunny DNS zone must be a valid domain name');
	}

	const name = input.name.trim();
	if (!name) {
		error(400, 'Name is required');
	}

	return {
		name,
		cidr: normalized.cidr,
		family: normalized.family,
		ipv6UseTransitAddress,
		whitelistStart,
		whitelistEnd,
		gatewayAddress,
		bunnyDnsZone,
		disabled: input.disabled ?? false
	};
}

function ipv6AllocationPrefixLength(prefix: IpamPrefix) {
	return prefix.ipv6UseTransitAddress ? v6Bits : vmIpv6PrefixLength;
}

function ipv6AllocationSize(prefix: IpamPrefix) {
	return 1n << BigInt(v6Bits - ipv6AllocationPrefixLength(prefix));
}

function ceilToMultiple(value: bigint, base: bigint, size: bigint) {
	if (value <= base) {
		return base;
	}
	const offset = value - base;
	return base + ((offset + size - 1n) / size) * size;
}

function ipv4GatewayValue(prefix: IpamPrefix) {
	return prefix.gatewayAddress ? parseAddress('ipv4', prefix.gatewayAddress) : null;
}

function ipv4AllocationBounds(prefix: IpamPrefix) {
	const usable = ipv4UsableRange(parseCidr(prefix.cidr));
	const whitelistStart = prefix.whitelistStart
		? parseAddress('ipv4', prefix.whitelistStart)
		: usable.first;
	const whitelistEnd = prefix.whitelistEnd
		? parseAddress('ipv4', prefix.whitelistEnd)
		: usable.last;
	const first = whitelistStart > usable.first ? whitelistStart : usable.first;
	const last = whitelistEnd < usable.last ? whitelistEnd : usable.last;

	return first <= last ? { first, last, gateway: ipv4GatewayValue(prefix) } : null;
}

function ipv6WhitelistBounds(prefix: IpamPrefix) {
	const range = parseCidr(prefix.cidr);
	const whitelistStart = prefix.whitelistStart
		? parseAddress('ipv6', prefix.whitelistStart)
		: range.start;
	const whitelistEnd = prefix.whitelistEnd ? parseAddress('ipv6', prefix.whitelistEnd) : range.end;
	const first = whitelistStart > range.start ? whitelistStart : range.start;
	const last = whitelistEnd < range.end ? whitelistEnd : range.end;

	return first <= last ? { first, last } : null;
}

function ipv6AllocationBounds(prefix: IpamPrefix) {
	const range = parseCidr(prefix.cidr);
	const bounds = ipv6WhitelistBounds(prefix);
	if (!bounds) {
		return null;
	}

	const allocationSize = ipv6AllocationSize(prefix);
	let first = ceilToMultiple(bounds.first, range.start, allocationSize);
	if (prefix.ipv6UseTransitAddress && first === range.start && range.start < range.end) {
		first += allocationSize;
	}
	const last = bounds.last - allocationSize + 1n;

	return first <= last ? { first, last, allocationSize } : null;
}

function prefixCapacity(prefix: IpamPrefix) {
	if (prefix.family === 'ipv4') {
		const bounds = ipv4AllocationBounds(prefix);
		if (!bounds) {
			return 0n;
		}
		const gatewayIsAllocatable =
			bounds.gateway !== null && bounds.gateway >= bounds.first && bounds.gateway <= bounds.last;
		const capacity = bounds.last - bounds.first + 1n - (gatewayIsAllocatable ? 1n : 0n);
		return capacity > 0n ? capacity : 0n;
	}

	const bounds = ipv6AllocationBounds(prefix);
	return bounds ? (bounds.last - bounds.first) / bounds.allocationSize + 1n : 0n;
}

function usedAllocationIndexes(
	family: IpFamily,
	allocations: Pick<IpamAllocation, 'address' | 'prefix'>[]
) {
	return new Set(
		allocations.flatMap((allocation) => {
			if (family === 'ipv6' && allocation.prefix) {
				return [new Address6(allocation.prefix).startAddress().bigInt().toString()];
			}
			if (allocation.address) {
				return [parseAddress(family, allocation.address).toString()];
			}
			return [];
		})
	);
}

async function prefixStats(db: QueryableDb, prefix: IpamPrefix): Promise<IpamPrefixWithStats> {
	const capacity = prefix.disabled ? 0n : prefixCapacity(prefix);
	const allocated = BigInt((await usedIndexesForPrefix(db, prefix)).size);
	const available = capacity > allocated ? capacity - allocated : 0n;

	return {
		...prefix,
		allocated: Number(allocated),
		capacity: capacity.toString(),
		available: available.toString(),
		hasCapacity: available > 0n
	};
}

export async function listIpamPrefixesWithStats(db: QueryableDb) {
	const prefixes = await db
		.select()
		.from(ipamPrefixes)
		.orderBy(asc(ipamPrefixes.family), asc(ipamPrefixes.cidr));

	return Promise.all(prefixes.map((prefix) => prefixStats(db, prefix)));
}

export async function getIpamAvailability(db: QueryableDb): Promise<IpamAvailability> {
	const prefixes = await listIpamPrefixesWithStats(db);
	const ipv4 = prefixes
		.filter((prefix) => prefix.family === 'ipv4')
		.reduce((total, prefix) => total + BigInt(prefix.available), 0n);
	const ipv6Transit = prefixes
		.filter((prefix) => prefix.family === 'ipv6' && prefix.ipv6UseTransitAddress)
		.reduce((total, prefix) => total + BigInt(prefix.available), 0n);
	const ipv6Prefixes = prefixes
		.filter((prefix) => prefix.family === 'ipv6' && !prefix.ipv6UseTransitAddress)
		.reduce((total, prefix) => total + BigInt(prefix.available), 0n);
	const ipv6 = ipv6Transit < ipv6Prefixes ? ipv6Transit : ipv6Prefixes;

	return {
		ipv4: { available: ipv4 > 0n, availableCount: ipv4.toString() },
		ipv6: { available: ipv6 > 0n, availableCount: ipv6.toString() }
	};
}

function randomBigIntBelow(maxExclusive: bigint) {
	if (maxExclusive <= 0n) {
		throw new Error('maxExclusive must be greater than 0');
	}

	const bitLength = maxExclusive.toString(2).length;
	const byteLength = Math.ceil(bitLength / 8);
	const maxRandom = 1n << BigInt(byteLength * 8);
	const cutoff = maxRandom - (maxRandom % maxExclusive);

	let value: bigint;
	do {
		const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
		value = bytes.reduce((total, byte) => (total << 8n) + BigInt(byte), 0n);
	} while (value >= cutoff);
	return value % maxExclusive;
}

function chooseWeightedPrefix<T extends { available: bigint }>(candidates: T[]) {
	const total = candidates.reduce((sum, candidate) => sum + candidate.available, 0n);
	if (total <= 0n) {
		return null;
	}

	let selected = randomBigIntBelow(total);
	for (const candidate of candidates) {
		if (selected < candidate.available) {
			return candidate;
		}
		selected -= candidate.available;
	}

	return candidates.at(-1) ?? null;
}

function randomIpv4Address(prefix: IpamPrefix, used: Set<string>) {
	const bounds = ipv4AllocationBounds(prefix);
	if (!bounds) {
		return null;
	}

	const value = bounds.first + randomBigIntBelow(bounds.last - bounds.first + 1n);
	if (value === bounds.gateway || used.has(value.toString())) {
		return null;
	}

	return formatAddress('ipv4', value);
}

function formatIpv6Allocation(prefix: IpamPrefix, value: bigint) {
	if (prefix.ipv6UseTransitAddress) {
		return { prefix: null, address: formatAddress('ipv6', value) };
	}

	return {
		prefix: formatPrefix('ipv6', value, ipv6AllocationPrefixLength(prefix)),
		address: null
	};
}

function randomIpv6Allocation(prefix: IpamPrefix, used: Set<string>) {
	const bounds = ipv6AllocationBounds(prefix);
	if (!bounds) {
		return null;
	}

	const slotCount = (bounds.last - bounds.first) / bounds.allocationSize + 1n;
	const value = bounds.first + randomBigIntBelow(slotCount) * bounds.allocationSize;
	if (used.has(value.toString())) {
		return null;
	}

	return formatIpv6Allocation(prefix, value);
}

function nextIpv4Address(prefix: IpamPrefix, used: Set<string>) {
	const bounds = ipv4AllocationBounds(prefix);
	if (!bounds) {
		return null;
	}

	for (let value = bounds.first; value <= bounds.last; value += 1n) {
		if (value === bounds.gateway || used.has(value.toString())) {
			continue;
		}
		return formatAddress('ipv4', value);
	}

	return null;
}

function nextIpv6Allocation(prefix: IpamPrefix, used: Set<string>) {
	const bounds = ipv6AllocationBounds(prefix);
	if (!bounds) {
		return null;
	}

	const cappedLast = bounds.first + bounds.allocationSize * MAX_SEQUENTIAL_IPV6_SLOTS;
	const last = bounds.last < cappedLast ? bounds.last : cappedLast;

	for (let value = bounds.first; value <= last; value += bounds.allocationSize) {
		if (used.has(value.toString())) {
			continue;
		}
		return formatIpv6Allocation(prefix, value);
	}

	return null;
}

function prefixMatchesKind(prefix: IpamPrefix, kind: AllocationKind) {
	if (prefix.disabled) {
		return false;
	}
	if (kind === 'ipv6-transit') {
		return prefix.ipv6UseTransitAddress;
	}
	if (kind === 'ipv6-prefix') {
		return !prefix.ipv6UseTransitAddress;
	}
	return true;
}

function allocationCountWhere(kind: AllocationKind) {
	return kind === 'ipv6-prefix'
		? isNotNull(ipamAllocations.prefix)
		: isNotNull(ipamAllocations.address);
}

async function eligiblePrefixesWithAvailableCounts(db: QueryableDb, kind: AllocationKind) {
	const family: IpFamily = kind === 'ipv4' ? 'ipv4' : 'ipv6';
	const prefixes = (
		await db
			.select()
			.from(ipamPrefixes)
			.where(and(eq(ipamPrefixes.family, family), eq(ipamPrefixes.disabled, false)))
			.orderBy(asc(ipamPrefixes.createdAt), asc(ipamPrefixes.cidr))
	).filter((prefix) => prefixMatchesKind(prefix, kind));

	if (prefixes.length === 0) {
		return [];
	}

	const counts = await db
		.select({
			ipamPrefixId: ipamAllocations.ipamPrefixId,
			used: sql<number>`count(*)::int`
		})
		.from(ipamAllocations)
		.where(and(eq(ipamAllocations.family, family), allocationCountWhere(kind)))
		.groupBy(ipamAllocations.ipamPrefixId);
	const usedByPrefixId = new Map(counts.map((row) => [row.ipamPrefixId, BigInt(row.used)]));

	return prefixes.flatMap((prefix) => {
		const capacity = prefixCapacity(prefix);
		const used = usedByPrefixId.get(prefix.id) ?? 0n;
		const available = capacity > used ? capacity - used : 0n;
		return available > 0n ? [{ prefix, available }] : [];
	});
}

function insertAllocation(
	tx: Transaction,
	kind: AllocationKind,
	vmId: string,
	macAddress: string,
	prefix: IpamPrefix,
	next: { address: string | null; prefix: string | null }
): Promise<PendingAllocation> {
	const family: IpFamily = kind === 'ipv4' ? 'ipv4' : 'ipv6';
	return tx.transaction(async (savepoint) => {
		const [inserted] = await savepoint
			.insert(ipamAllocations)
			.values({
				ipamPrefixId: prefix.id,
				associatedVmId: vmId,
				family,
				address: next.address,
				prefix: next.prefix,
				prefixLength: family === 'ipv4' ? vmIpv4PrefixLength : ipv6AllocationPrefixLength(prefix),
				macAddress
			})
			.returning();

		return { ...inserted, sourcePrefix: prefix };
	});
}

async function usedIndexesForPrefix(db: QueryableDb, prefix: IpamPrefix) {
	const allocations = await db.query.ipamAllocations.findMany({
		where: eq(ipamAllocations.ipamPrefixId, prefix.id),
		columns: { address: true, prefix: true }
	});
	return usedAllocationIndexes(prefix.family, allocations);
}

async function createRandomKindAllocation(
	tx: Transaction,
	kind: AllocationKind,
	vmId: string,
	macAddress: string
) {
	const candidates = await eligiblePrefixesWithAvailableCounts(tx, kind);

	for (let attempt = 0; attempt < randomAllocationAttempts; attempt += 1) {
		const selected = chooseWeightedPrefix(candidates);
		if (!selected) {
			return null;
		}

		// biome-ignore lint/performance/noAwaitInLoops: allocation retries run inside one transaction and each attempt must see the previous attempt's outcome
		const used = await usedIndexesForPrefix(tx, selected.prefix);
		const next =
			kind === 'ipv4'
				? { address: randomIpv4Address(selected.prefix, used), prefix: null }
				: randomIpv6Allocation(selected.prefix, used);
		if (!(next?.address || next?.prefix)) {
			continue;
		}

		try {
			return await insertAllocation(tx, kind, vmId, macAddress, selected.prefix, next);
		} catch (err) {
			if (uniqueViolation(err)) {
				continue;
			}
			throw err;
		}
	}

	return null;
}

async function createSequentialKindAllocation(
	tx: Transaction,
	kind: AllocationKind,
	vmId: string,
	macAddress: string
): Promise<PendingAllocation> {
	const candidates = await eligiblePrefixesWithAvailableCounts(tx, kind);

	for (const { prefix } of candidates) {
		// biome-ignore lint/performance/noAwaitInLoops: prefixes are tried in priority order inside one transaction and the first with room wins
		const used = await usedIndexesForPrefix(tx, prefix);
		const next =
			kind === 'ipv4'
				? { address: nextIpv4Address(prefix, used), prefix: null }
				: nextIpv6Allocation(prefix, used);

		if (!(next?.address || next?.prefix)) {
			continue;
		}
		return insertAllocation(tx, kind, vmId, macAddress, prefix, next);
	}

	error(409, `No available ${allocationKindLabels[kind]}`);
}

async function createLocalAllocation(
	tx: Transaction,
	kind: AllocationKind,
	vmId: string,
	macAddress: string
) {
	const randomAllocation = await createRandomKindAllocation(tx, kind, vmId, macAddress);
	if (randomAllocation) {
		return randomAllocation;
	}

	for (let attempt = 0; attempt < sequentialAllocationAttempts; attempt += 1) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: retries after a unique-constraint race must run one after another
			return await createSequentialKindAllocation(tx, kind, vmId, macAddress);
		} catch (err) {
			if (uniqueViolation(err)) {
				continue;
			}
			throw err;
		}
	}

	error(409, `No available ${allocationKindLabels[kind]}`);
}

function tenantDescription(vmId: string, label: string) {
	return `tenant ${vmId.slice(-8)} ${label}`;
}

async function createVyosDelegatedRoute(allocations: PendingAllocation[], vmId: string) {
	if (!isVyosConfigured()) {
		return;
	}

	const ipv6TransitAllocation = findIpv6TransitAllocation(allocations);
	const ipv6PrefixAllocation = findIpv6PrefixAllocation(allocations);

	if (!(ipv6PrefixAllocation?.prefix && ipv6TransitAllocation?.address)) {
		return;
	}

	const client = new VyosClient();
	await client.createDelegatedRoute({
		destination: ipv6PrefixAllocation.prefix,
		gateway: ipv6TransitAllocation.address,
		description: tenantDescription(vmId, 'IPv6 prefix')
	});
}

async function deleteVyosDelegatedRoute(allocations: PendingAllocation[]) {
	if (!isVyosConfigured()) {
		return;
	}

	const ipv6PrefixAllocation = findIpv6PrefixAllocation(allocations);

	if (!ipv6PrefixAllocation?.prefix) {
		return;
	}

	const client = new VyosClient();
	await client.deleteDelegatedRoute(ipv6PrefixAllocation.prefix);
}

export async function vmAllocations(db: QueryableDb, vmId: string): Promise<PendingAllocation[]> {
	const allocations = await db.query.ipamAllocations.findMany({
		where: eq(ipamAllocations.associatedVmId, vmId),
		with: {
			ipamPrefix: true
		}
	});

	return allocations.map(({ ipamPrefix, ...allocation }) => ({
		...allocation,
		sourcePrefix: ipamPrefix
	}));
}

function assertIpv6AllocationPair(
	transitAllocation: PendingAllocation,
	prefixAllocation: PendingAllocation
) {
	if (transitAllocation.family !== 'ipv6') {
		error(500, `Expected IPv6 transit allocation, received ${transitAllocation.family}`);
	}
	if (prefixAllocation.family !== 'ipv6') {
		error(500, `Expected IPv6 prefix allocation, received ${prefixAllocation.family}`);
	}
	if (!transitAllocation.sourcePrefix.ipv6UseTransitAddress) {
		error(
			500,
			`Expected ${transitAllocation.sourcePrefix.cidr} to be an IPv6 transit address block`
		);
	}
	if (prefixAllocation.sourcePrefix.ipv6UseTransitAddress) {
		error(
			500,
			`Expected ${prefixAllocation.sourcePrefix.cidr} to be an IPv6 delegated prefix block`
		);
	}
	if (!transitAllocation.address) {
		error(500, `IPv6 transit allocation ${transitAllocation.id} is missing an address`);
	}
	if (transitAllocation.prefix) {
		error(500, `IPv6 transit allocation ${transitAllocation.id} unexpectedly has a prefix`);
	}
	if (prefixAllocation.address) {
		error(500, `IPv6 prefix allocation ${prefixAllocation.id} unexpectedly has an address`);
	}
	if (!prefixAllocation.prefix) {
		error(500, `IPv6 prefix allocation ${prefixAllocation.id} is missing a prefix`);
	}
}

export async function allocateVmNetworking(
	db: Db,
	params: { vmId: string; macAddress: string; mode: NetworkingMode }
) {
	const allocations: PendingAllocation[] = [];

	try {
		if (params.mode === 'both') {
			allocations.push(
				await db.transaction((tx) =>
					createLocalAllocation(tx, 'ipv4', params.vmId, params.macAddress)
				)
			);
		}

		const ipv6TransitAllocation = await db.transaction((tx) =>
			createLocalAllocation(tx, 'ipv6-transit', params.vmId, params.macAddress)
		);
		allocations.push(ipv6TransitAllocation);

		const ipv6PrefixAllocation = await db.transaction((tx) =>
			createLocalAllocation(tx, 'ipv6-prefix', params.vmId, params.macAddress)
		);
		allocations.push(ipv6PrefixAllocation);

		assertIpv6AllocationPair(ipv6TransitAllocation, ipv6PrefixAllocation);

		return allocations;
	} catch (err) {
		await releaseVmNetworking(db, params.vmId).catch((releaseErr) => {
			console.warn(
				`Failed to release networking for VM ${params.vmId} after allocation error`,
				releaseErr
			);
		});
		throw err;
	}
}

export async function ensureVmDelegatedRoute(db: QueryableDb, vmId: string) {
	await createVyosDelegatedRoute(await vmAllocations(db, vmId), vmId);
}

export async function releaseVmNetworking(db: QueryableDb, vmId: string) {
	const allocations = await vmAllocations(db, vmId);
	await deleteVyosDelegatedRoute(allocations);
	await deletePtrRecords(db, allocations).catch((err) => {
		console.warn(`Failed to delete PTR records for VM ${vmId}`, err);
	});
	await db.delete(ipamAllocations).where(eq(ipamAllocations.associatedVmId, vmId));
}

export async function reconcileOrphanedIpamAllocations(db: QueryableDb, limit = 200) {
	const orphaned = await db
		.selectDistinct({ vmId: ipamAllocations.associatedVmId })
		.from(ipamAllocations)
		.innerJoin(vms, eq(vms.id, ipamAllocations.associatedVmId))
		.where(eq(vms.active, false))
		.limit(limit);

	let released = 0;
	let failed = 0;
	for (const { vmId } of orphaned) {
		try {
			// biome-ignore lint/performance/noAwaitInLoops: releasing networking writes VyOS and Bunny config, which must not race between VMs
			await releaseVmNetworking(db, vmId);
			released += 1;
		} catch (err) {
			failed += 1;
			console.warn(`Failed to reconcile orphaned IPAM allocations for VM ${vmId}`, err);
		}
	}

	return { checked: orphaned.length, released, failed };
}
