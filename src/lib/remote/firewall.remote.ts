import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { vms, firewallGroups, firewallRules } from '$lib/server/db/schema';
import { ulid } from '$lib/server/id';
import { requireProjectAccess } from '$lib/server/auth-context';
import { getBackend } from '$lib/server/backends';


const getFirewallRulesParams = type({ groupId: 'string' });
export const getFirewallRules = query(getFirewallRulesParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const group = await db.query.firewallGroups.findFirst({
		where: eq(firewallGroups.id, params.groupId)
	});
	if (!group) error(404, `Firewall group "${params.groupId}" not found`);
	if (group.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, group.ownerProjectId);
	}

	return await db.query.firewallRules.findMany({
		where: eq(firewallRules.groupId, params.groupId),
		orderBy: (rules, { asc }) => [asc(rules.pos), asc(rules.id)]
	});
});

const createFirewallRuleParams = type({
	groupId: 'string',
	action: "'ACCEPT' | 'DROP' | 'REJECT'",
	type: "'in' | 'out' | 'forward'",
	protocol: 'string?',
	destinationAddresses: 'string?',
	destinationPorts: 'string?',
	sourceAddresses: 'string?',
	sourcePorts: 'string?',
	enable: 'boolean?'
});
export const createFirewallRule = command(createFirewallRuleParams, async (params) => {
  const event = getRequestEvent();
  if (!event?.locals.user) error(401, 'Authentication required');

  const db = initDrizzle();
  const group = await db.query.firewallGroups.findFirst({
    where: eq(firewallGroups.id, params.groupId)
  });
  if (!group) error(404, `Firewall group "${params.groupId}" not found`);
  if (group.ownerProjectId) {
    await requireProjectAccess(db, event.locals.user.id, group.ownerProjectId, 'read_write');
  }

  await db.insert(firewallRules).values({
    id: ulid(),
    groupId: params.groupId,
    action: params.action,
    type: params.type,
    protocol: params.protocol ?? null,
    destinationAddresses: params.destinationAddresses ?? null,
    destinationPorts: params.destinationPorts ?? null,
    sourceAddresses: params.sourceAddresses ?? null,
    sourcePorts: params.sourcePorts ?? null,
    pos: db.$count(firewallRules, eq(firewallRules.groupId, params.groupId)),
    enable: params.enable ?? true
  });

  const { groupId, ...fw_params } = params;

	await getBackend("proxmox").createGroupFirewallRule(fw_params, groupId)
});

const deleteFirewallRuleParams = type({ ruleId: 'string' });
export const deleteFirewallRule = command(deleteFirewallRuleParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const rule = await db.query.firewallRules.findFirst({
		where: eq(firewallRules.id, params.ruleId),
		with: { group: true }
	});
	if (!rule) error(404, `Firewall rule "${params.ruleId}" not found`);
	if (rule.group.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, rule.group.ownerProjectId, 'read_write');
	}

  const groupId = rule.groupId;

  await getBackend("proxmox").deleteGroupFirewallRule(rule.pos, groupId)

  // explicitly only delete from db if backend delete succeeds.
	await db.delete(firewallRules).where(eq(firewallRules.id, params.ruleId));
});

const editFirewallRuleParams = type({
	ruleId: 'string',
	action: "'ACCEPT' | 'DROP' | 'REJECT'",
	type: "'in' | 'out' | 'forward'",
	protocol: 'string?',
	destinationAddresses: 'string?',
	destinationPorts: 'string?',
	sourceAddresses: 'string?',
	sourcePorts: 'string?',
	enable: 'boolean?'
});
export const editFirewallRule = command(editFirewallRuleParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const rule = await db.query.firewallRules.findFirst({
		where: eq(firewallRules.id, params.ruleId),
		with: { group: true }
	});
	if (!rule) error(404, `Firewall rule "${params.ruleId}" not found`);
	if (rule.group.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, rule.group.ownerProjectId, 'read_write');
	}

  const { ruleId, ...fields } = params;

  await getBackend("proxmox").editGroupFirewallRule(fields, rule.pos, rule.groupId)

	await db.update(firewallRules).set(fields).where(eq(firewallRules.id, params.ruleId));
});

const moveFirewallRuleParams = type({
	ruleId: 'string',
	newPos: 'number'
});
export const moveFirewallRule = command(moveFirewallRuleParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const rule = await db.query.firewallRules.findFirst({
		where: eq(firewallRules.id, params.ruleId),
		with: { group: true }
	});
	if (!rule) error(404, `Firewall rule "${params.ruleId}" not found`);
	if (rule.group.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, rule.group.ownerProjectId, 'read_write');
  }

  await getBackend("proxmox").moveGroupFirewallRule(rule.pos, params.newPos, rule.groupId)

	await db.update(firewallRules)
		.set({ pos: params.newPos }) // todo: deal with conflicting positions and updating positions as needed
		.where(eq(firewallRules.id, params.ruleId));
});

const createFirewallGroupParams = type({
	projectId: 'string',
	name: 'string'
});
export const createFirewallGroup = command(createFirewallGroupParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireProjectAccess(db, event.locals.user.id, params.projectId, 'read_write');

	const id = ulid();

	await getBackend("proxmox").createFirewallGroup(id)

	await db.insert(firewallGroups).values({
		id,
    name: params.name,
		ownerProjectId: params.projectId
	});

  return { id };
});

const deleteFirewallGroupParams = type({ groupId: 'string' });
export const deleteFirewallGroup = command(deleteFirewallGroupParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const group = await db.query.firewallGroups.findFirst({
		where: eq(firewallGroups.id, params.groupId)
	});
	if (!group) error(404, `Firewall group "${params.groupId}" not found`);
	if (group.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, group.ownerProjectId, 'read_write');
  }

  // todo: determine what we want to do with actual VM rules when group is deleted, or possibly require that all VMs are removed from group before deletion.

  await getBackend("proxmox").deleteFirewallGroup(params.groupId)

	await db.delete(firewallRules).where(eq(firewallRules.groupId, params.groupId));
	await db.delete(firewallGroups).where(eq(firewallGroups.id, params.groupId));
});


const assignVmToGroupParams = type({ vmId: 'string', groupId: 'string' });
export const assignVmToGroup = command(assignVmToGroupParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) error(404, `VM "${params.vmId}" not found`);
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId, 'read_write');
	}

	const group = await db.query.firewallGroups.findFirst({
		where: eq(firewallGroups.id, params.groupId)
	});
	if (!group) error(404, `Firewall group "${params.groupId}" not found`);

	await getBackend("proxmox").addVMToFirewallGroup(params.groupId, vm.id, vm.proxmoxId ?? undefined)

	await db.update(vms)
		.set({ firewallGroupId: params.groupId })
		.where(eq(vms.id, params.vmId));
});



const removeVmFromGroupParams = type({ vmId: 'string' });
export const removeVmFromGroup = command(removeVmFromGroupParams, async (params) => {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	const vm = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!vm) error(404, `VM "${params.vmId}" not found`);
	if (vm.ownerProjectId) {
		await requireProjectAccess(db, event.locals.user.id, vm.ownerProjectId, 'read_write');
	}

	const groupId = vm.firewallGroupId;
  if (!groupId) return;

 	await getBackend("proxmox").removeVMFromFirewallGroup(vm.id, vm.proxmoxId ?? undefined)

	await db.update(vms)
		.set({ firewallGroupId: null })
		.where(eq(vms.id, params.vmId));
});
