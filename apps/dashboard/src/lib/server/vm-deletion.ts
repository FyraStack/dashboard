import { getRequestEvent } from '$app/server';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { initDrizzle, closeRequestDb, type Database } from '$lib/server/db';
import { ipAssignments, paymentPeriods, vms, volumes } from '$lib/server/db/schema';
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
	await db.update(vms).set({ status: 'deleting', statusError: null }).where(eq(vms.id, row.id));
	runInBackground(deleteVmResources(row), `vm-delete-${row.id}`);
}

export const DELETED_VM_RETENTION_DAYS = 90;

export async function purgeExpiredDeletedVms(now = Date.now(), limit = 50) {
	const db = initDrizzle();
	const cutoff = now - DELETED_VM_RETENTION_DAYS * 86_400_000;

	const expired = await db
		.select({ id: vms.id })
		.from(vms)
		.where(and(eq(vms.active, false), isNotNull(vms.deletedAt), lt(vms.deletedAt, cutoff)))
		.limit(limit);
	const vmIds = expired.map((row) => row.id);
	if (vmIds.length === 0) return { purged: 0 };

	await db
		.update(volumes)
		.set({ associatedVmId: null })
		.where(inArray(volumes.associatedVmId, vmIds));
	await db.delete(ipAssignments).where(inArray(ipAssignments.associatedVmId, vmIds));
	await db.delete(paymentPeriods).where(inArray(paymentPeriods.vmId, vmIds));
	await db.delete(vms).where(inArray(vms.id, vmIds));

	return { purged: vmIds.length };
}

function initOwnedDb() {
	const event = getRequestEvent();
	const ownsDb = !event.locals.db;
	const db = initDrizzle();
	return {
		db,
		close: () => {
			if (ownsDb) closeRequestDb(event);
		}
	};
}

async function deleteVmResources(row: DeletableVm): Promise<void> {
	try {
		await getBackend(row.backend).deleteVm(row.id, row.proxmoxId ?? undefined);
	} catch (err) {
		console.warn(`Failed to delete backend VM ${row.id}`, err);
		const { db, close } = initOwnedDb();
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
			close();
		}
		return;
	}

	const { db, close } = initOwnedDb();
	try {
		const claimed = await db
			.update(vms)
			.set({ active: false, deletedAt: Date.now() })
			.where(and(eq(vms.id, row.id), eq(vms.active, true)))
			.returning({ id: vms.id });
		if (claimed.length === 0) return;

		await releaseVmNetworking(db, row.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${row.id}`, err);
		});

		const metered = await meterResourceThrough('vm', row.id).catch((err) => {
			console.warn(`Failed to meter VM ${row.id} during deletion`, err);
			return null;
		});
		if (row.ownerProjectId && (!metered?.event || metered.syncStatus === 'synced')) {
			await deleteProjectServerEntity(row.ownerProjectId, row.id).catch((err) => {
				console.warn(`Failed to delete Autumn entity for VM ${row.id}`, err);
			});
		}

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
			.catch((updateErr) =>
				console.error(`VM ${row.id} deletion status update failed:`, updateErr)
			);
	} finally {
		close();
	}
}
