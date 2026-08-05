import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { asc, eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { ipamAllocations, ipamPtrRecords, vms } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/auth-context';
import { isBunnyConfigured } from '$lib/server/bunny';
import { setPtrRecord } from '$lib/server/ptr-records';
import type { PermissionLevel } from '$lib/auth/organization-permissions';

async function requireVmAccess(vmId: string, level?: PermissionLevel) {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({ where: eq(vms.id, vmId) });
	if (!vm) error(404, 'VM not found');
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId, level);
	}

	return { db, vm };
}

const vmParams = type({ vmId: 'string' });

export const getVmNetworking = query(vmParams, async (params) => {
	const { db } = await requireVmAccess(params.vmId);

	const allocations = await db.query.ipamAllocations.findMany({
		where: eq(ipamAllocations.associatedVmId, params.vmId),
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
});

const setPtrParams = type({
	vmId: 'string',
	allocationId: 'string',
	address: 'string?',
	value: 'string'
});

export const setVmPtrRecord = command(setPtrParams, async (params) => {
	const { db } = await requireVmAccess(params.vmId, 'read_write');

	const allocation = await db.query.ipamAllocations.findFirst({
		where: eq(ipamAllocations.id, params.allocationId),
		with: { ipamPrefix: true }
	});
	if (!allocation || allocation.associatedVmId !== params.vmId) {
		error(404, 'IP allocation not found');
	}

	const address = params.address?.trim() || allocation.address;
	if (!address) error(400, 'An IP address inside the subnet is required');

	const { ipamPrefix, ...rest } = allocation;
	return setPtrRecord(db, { ...rest, sourcePrefix: ipamPrefix }, address, params.value);
});
