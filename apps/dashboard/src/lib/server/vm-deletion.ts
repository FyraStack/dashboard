import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { initDrizzle, closeRequestDb, type Database } from '$lib/server/db';
import { vms } from '$lib/server/db/schema';
import { getBackend } from '$lib/server/backends';
import { deleteProjectServerEntity } from '$lib/server/billing/autumn';
import { meterResourceThrough } from '$lib/server/billing/metering';
import { releaseVmNetworking } from '$lib/server/ipam';
import { runInBackground } from '$lib/server/background';

type DeletableVm = {
	id: string;
	backend: 'proxmox';
	proxmoxId: number | null;
	ownerProjectId: string | null;
};

export async function queueVmDeletion(db: Database, row: DeletableVm): Promise<void> {
	await db
		.update(vms)
		.set({ status: 'deleting', statusError: null })
		.where(eq(vms.id, row.id));
	runInBackground(deleteVmResources(row), `vm-delete-${row.id}`);
}

async function deleteVmResources(row: DeletableVm): Promise<void> {
	const event = getRequestEvent();
	try {
		await getBackend(row.backend).deleteVm(row.id, row.proxmoxId ?? undefined);
	} catch (err) {
		console.warn(`Failed to delete backend VM ${row.id}`, err);
		const db = initDrizzle();
		try {
			await db
				.update(vms)
				.set({
					status: 'error',
					statusError: err instanceof Error ? err.message : 'Failed to deprovision VM'
				})
				.where(eq(vms.id, row.id));
		} catch (updateErr) {
			console.error(`VM ${row.id} deletion status update failed:`, updateErr);
		} finally {
			closeRequestDb(event);
		}
		return;
	}

	const db = initDrizzle();
	try {
		const metered = await meterResourceThrough('vm', row.id);
		if (row.ownerProjectId && (!metered?.event || metered.syncStatus === 'synced')) {
			await deleteProjectServerEntity(row.ownerProjectId, row.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${row.id}`, err);
			});
		}

		await releaseVmNetworking(db, row.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${row.id}`, err);
		});

		await db.update(vms).set({ active: false }).where(eq(vms.id, row.id));
		console.log(`VM ${row.id} deletion completed`);
	} catch (err) {
		console.error(`VM ${row.id} deletion cleanup failed:`, err);
		await db
			.update(vms)
			.set({
				status: 'error',
				statusError: err instanceof Error ? err.message : 'Failed to clean up VM resources'
			})
			.where(eq(vms.id, row.id))
			.catch((updateErr) => console.error(`VM ${row.id} deletion status update failed:`, updateErr));
	} finally {
		closeRequestDb(event);
	}
}
