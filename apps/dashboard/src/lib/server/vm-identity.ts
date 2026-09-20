import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import type { VmBackend, VmInfo } from '$lib/server/backends';

type IdentifiableVm = { id: string; proxmoxId: number | null };

export function findLiveVm<T extends VmInfo>(liveVms: T[], row: IdentifiableVm): T | null {
	const stableId = row.id.toLowerCase();
	const byStableId = liveVms.find((vm) => vm.stableId === stableId);
	if (byStableId) return byStableId;
	if (row.proxmoxId == null) return null;
	return liveVms.find((vm) => vm.proxmoxId === row.proxmoxId && vm.stableId === undefined) ?? null;
}

async function nextSequenceValue(db: Database): Promise<number> {
	const result = await db.execute(sql`select nextval('proxmox_vmid_seq') as "vmid"`);
	return Number((result.rows[0] as { vmid: string | number }).vmid);
}

export async function allocateProxmoxVmid(db: Database, backend: VmBackend): Promise<number> {
	const usedIds = new Set((await backend.listUsedProxmoxIds?.()) ?? []);
	let candidate = await nextSequenceValue(db);
	while (usedIds.has(candidate)) candidate = await nextSequenceValue(db);
	return candidate;
}
