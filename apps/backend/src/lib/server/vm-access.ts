import { eq } from 'drizzle-orm';
import type { PermissionLevel } from 'stack-shared/project-roles';
import { requireAdmin, requireProjectAccess } from '#lib/server/auth-context.js';
import type { AppUser } from '#lib/server/context.js';
import type { Database } from '#lib/server/db/index.js';
import { vms } from '#lib/server/db/schema.js';
import { error } from '#lib/server/http.js';

type VmRow = typeof vms.$inferSelect;

export async function requireVm(db: Database, vmId: string) {
	const row = await db.query.vms.findFirst({ where: eq(vms.id, vmId), with: { vmType: true } });
	if (!row) {
		error(404, `VM "${vmId}" not found`);
	}
	return row;
}

export async function requireVmAccess(
	db: Database,
	user: AppUser,
	vm: Pick<VmRow, 'ownerProjectId'>,
	level?: PermissionLevel | 'owner'
) {
	if (vm.ownerProjectId === null) {
		await requireAdmin(db, user.id);
		return;
	}
	await requireProjectAccess(db, user.id, vm.ownerProjectId, level);
}

export async function requireAccessibleVm(
	db: Database,
	user: AppUser,
	vmId: string,
	level?: PermissionLevel | 'owner'
) {
	const row = await requireVm(db, vmId);
	await requireVmAccess(db, user, row, level);
	return row;
}

type VmGuardFields = Pick<VmRow, 'name' | 'active' | 'status'>;

export function assertPowerable(vm: VmGuardFields) {
	if (!vm.active) {
		error(409, `VM "${vm.name}" is not active`);
	}
	if (vm.status === 'deleting') {
		error(409, `VM "${vm.name}" is being deleted`);
	}
}

export function assertMutable(vm: VmGuardFields) {
	assertPowerable(vm);
	if (vm.status === 'provisioning') {
		error(409, `VM "${vm.name}" is still provisioning`);
	}
}
