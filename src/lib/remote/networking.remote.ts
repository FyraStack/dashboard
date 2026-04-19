import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { ipBlocks, ipAssignments, vms } from '$lib/server/db/schema';
import { requireProjectAccess } from '$lib/server/auth-context';

type ListBlocksResult = { id: string; ipBlock: string }[];

export const listIpBlocks = query(type({ projectId: 'string' }), async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();

	return db.query.ipBlocks.findMany();
});

const listAssignmentsParams = type({ vmId: 'string' });
type ListAssignmentsResult = {
	ip: string;
	ipBlockId: string;
}[];

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

const unassignParams = type({ assignmentId: 'string', ip: 'string' });
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
