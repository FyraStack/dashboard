import { sql } from 'drizzle-orm';
import type { VmBackend, VmInfo } from '#lib/server/backends/index.js';
import type { Database } from '#lib/server/db/index.js';

export function findLiveVm<T extends VmInfo>(liveVms: T[], row: { id: string }): T | null {
	const stableId = row.id.toLowerCase();
	return liveVms.find((vm) => vm.stableId === stableId) ?? null;
}

async function nextSequenceValue(db: Database): Promise<number> {
	const result = await db.execute(sql`select nextval('proxmox_vmid_seq') as "vmid"`);
	return Number((result.rows[0] as { vmid: string | number }).vmid);
}

export async function allocateProxmoxVmid(db: Database, backend: VmBackend): Promise<number> {
	const usedIds = (await backend.listUsedProxmoxIds?.()) ?? new Set<number>();
	let candidate = await nextSequenceValue(db);
	while (usedIds.has(candidate)) {
		// biome-ignore lint/performance/noAwaitInLoops: each sequence value is only drawn after the previous candidate was found taken
		candidate = await nextSequenceValue(db);
	}
	return candidate;
}
