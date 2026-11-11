import { asc, eq } from 'drizzle-orm';
import { requireUser } from '#lib/server/auth-context.js';
import { isBunnyConfigured } from '#lib/server/bunny.js';
import { ipamAllocations, ipamPtrRecords } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';
import { captureServerEvent } from '#lib/server/posthog.js';
import { setPtrRecord } from '#lib/server/ptr-records.js';
import { requireAccessibleVm } from '#lib/server/vm-access.js';

export interface GetVmNetworkingInput {
	vmId: string;
}
export interface SetVmPtrRecordInput {
	address?: string;
	allocationId: string;
	value: string;
	vmId: string;
}

export async function getVmNetworking(input: GetVmNetworkingInput) {
	const { db, user } = requireUser();
	await requireAccessibleVm(db, user, input.vmId);

	const allocations = await db.query.ipamAllocations.findMany({
		where: eq(ipamAllocations.associatedVmId, input.vmId),
		with: { ipamPrefix: true, ptrRecords: { orderBy: asc(ipamPtrRecords.address) } },
		orderBy: asc(ipamAllocations.createdAt)
	});

	const bunnyConfigured = isBunnyConfigured();

	return {
		allocations: allocations.map((allocation) => ({
			id: allocation.id,
			family: allocation.family,
			address: allocation.address,
			prefix: allocation.prefix,
			prefixLength: allocation.prefixLength,
			gateway: allocation.ipamPrefix.gatewayAddress,
			ptrEditable: bunnyConfigured && Boolean(allocation.ipamPrefix.bunnyDnsZone),
			ptrRecords: allocation.ptrRecords.map((record) => ({
				address: record.address,
				value: record.value
			}))
		}))
	};
}

export async function setVmPtrRecord(input: SetVmPtrRecordInput) {
	const { db, user } = requireUser();
	await requireAccessibleVm(db, user, input.vmId, 'read_write');

	const allocation = await db.query.ipamAllocations.findFirst({
		where: eq(ipamAllocations.id, input.allocationId),
		with: { ipamPrefix: true }
	});
	if (!allocation || allocation.associatedVmId !== input.vmId) {
		error(404, 'IP allocation not found');
	}

	const address = input.address?.trim() || allocation.address;
	if (!address) {
		error(400, 'An IP address inside the subnet is required');
	}

	const { ipamPrefix, ...rest } = allocation;
	const result = await setPtrRecord(
		db,
		{ ...rest, sourcePrefix: ipamPrefix },
		address,
		input.value
	);
	captureServerEvent('vm_ptr_record_set', { vm_id: input.vmId });
	return result;
}
