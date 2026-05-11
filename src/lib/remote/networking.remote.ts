import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { ipBlocks, ipAssignments, vms } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/auth-context';
import { createVMandAssignIPs, deleteIP, deleteVM } from '$lib/server/netbox';

export const listIpBlocks = query(type({ projectId: 'string' }), async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId);

	return db.query.ipBlocks.findMany();
});

const listAssignmentsParams = type({ vmId: 'string' });

export const listAssignments = query(listAssignmentsParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) error(404, 'VM not found');
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId);
	}

	return db.query.ipAssignments.findMany({
		where: eq(ipAssignments.associatedVmId, params.vmId),
		columns: { ip: true, ipBlockId: true }
	});
});

const assignParams = type({ vmId: 'string', blockId: 'string', ip: 'string' });
export const assignIp = command(assignParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) error(404, 'VM not found');
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId, 'admin');
	}

	await db.insert(ipAssignments).values({
		ip: params.ip,
		ipBlockId: params.blockId,
		associatedVmId: params.vmId
	});
});

const unassignParams = type({ ip: 'string' });
export const unassignIp = command(unassignParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const assignment = await db.query.ipAssignments.findFirst({
		where: eq(ipAssignments.ip, params.ip)
	});
	if (!assignment) error(404, 'Assignment not found');
	if (!assignment.associatedVmId) error(400, 'Assignment has no associated VM');

	const vm = await db.query.vms.findFirst({ where: eq(vms.id, assignment.associatedVmId) });
	if (!vm) error(404, 'VM not found');
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId, 'admin');
	}

	await db.delete(ipAssignments).where(eq(ipAssignments.ip, params.ip));
});

const testParams = type({ ip: 'string' });

export const testNetworking = command(testParams, async (params) => {
	let ids = await createVMandAssignIPs('01KRA74DC5GA63Y8QE9RNTWBT9', 'aa:bb:cc:11:22:39', [
		'135.17.80.89',
		'2001:db8:109::10/64'
	]);

	console.log('finished creating vm. deleting in 30 seconds');

	await new Promise((resolve) => setTimeout(resolve, 30000));

	console.log('deleting');

	await deleteVM(ids.netbox_vm_id, ids.netbox_vm_interface_id, ids.netbox_mac_address_id);

	for (const ip_address_id of ids.netbox_ip_address_ids) {
		await deleteIP(ip_address_id);
	}
});
