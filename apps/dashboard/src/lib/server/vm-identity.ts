import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import type { VmBackend, VmInfo } from '$lib/server/backends';

export function findLiveVm<T extends VmInfo>(liveVms: T[], row: { id: string }): T | null {
	const stableId = row.id.toLowerCase();
	return liveVms.find((vm) => vm.stableId === stableId) ?? null;
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
