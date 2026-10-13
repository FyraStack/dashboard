import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, lt, notInArray } from 'drizzle-orm';
import { getBackend } from '#lib/server/backends/index.js';
import { runInBackground } from '#lib/server/background.js';
import { deleteProjectServerEntity } from '#lib/server/billing/autumn.js';
import { hasUnsyncedUsageEvents, meterResourceThrough } from '#lib/server/billing/metering.js';
import { closeRequestDb, type Database, initDrizzle } from '#lib/server/db/index.js';
import {
	billingMeters,
	ipAssignments,
	paymentPeriods,
	vms,
	volumes
} from '#lib/server/db/schema.js';
import { releaseVmNetworking } from '#lib/server/ipam.js';
import { getRequestEvent } from '$app/server';

interface DeletableVm {
	active: boolean;
	backend: 'proxmox';
	id: string;
	name: string;
	ownerProjectId: string | null;
	proxmoxId: number | null;
	status: 'provisioning' | 'ready' | 'error' | 'deleting';
}

function rejectProvisioningDeletion(row: Pick<DeletableVm, 'name'>): never {
	error(409, `VM "${row.name}" is still provisioning. Wait for it to finish before deleting it.`);
}

async function claimVmDeletion(db: Database, vmId: string) {
	const claimed = await db
		.update(vms)
		.set({ status: 'deleting', statusError: null })
		.where(
			and(
				eq(vms.id, vmId),
				eq(vms.active, true),
				notInArray(vms.status, ['deleting', 'provisioning'])
			)
		)
		.returning({ id: vms.id, proxmoxId: vms.proxmoxId });
	return claimed.at(0) ?? null;
}

export async function queueVmDeletion(db: Database, row: DeletableVm): Promise<boolean> {
	if (!row.active || row.status === 'deleting') {
		return false;
	}
	if (row.status === 'provisioning') {
		rejectProvisioningDeletion(row);
	}
	await meterResourceThrough('vm', row.id).catch((err) => {
		console.warn(`Failed to close billing meter for VM ${row.id} before deletion`, err);
	});
	const claimed = await claimVmDeletion(db, row.id);
	if (!claimed) {
		return false;
	}
	runInBackground(
		deleteVmResources({ ...row, proxmoxId: claimed.proxmoxId }),
		`vm-delete-${row.id}`
	);
	return true;
}

async function reopenBillingMeter(db: Database, vmId: string) {
	await db
		.update(billingMeters)
		.set({ active: true, endedAt: null, lastMeteredAt: Date.now() })
		.where(
			and(
				eq(billingMeters.resourceType, 'vm'),
				eq(billingMeters.resourceId, vmId),
				eq(billingMeters.active, false)
			)
		);
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
	if (vmIds.length === 0) {
		return { purged: 0 };
	}

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
			if (ownsDb) {
				closeRequestDb(event);
			}
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
			const failed = await db
				.update(vms)
				.set({
					status: 'error',
					statusError: err instanceof Error ? err.message : 'Failed to deprovision VM'
				})
				.where(and(eq(vms.id, row.id), eq(vms.active, true), eq(vms.status, 'deleting')))
				.returning({ id: vms.id });
			if (failed.length > 0) {
				await reopenBillingMeter(db, row.id);
			}
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
		if (claimed.length === 0) {
			return;
		}

		await releaseVmNetworking(db, row.id).catch((err) => {
			console.warn(`Failed to release networking for VM ${row.id}`, err);
		});

		const unsynced = await hasUnsyncedUsageEvents('vm', row.id).catch((err) => {
			console.warn(`Failed to check usage events for VM ${row.id} during deletion`, err);
			return true;
		});
		if (row.ownerProjectId && !unsynced) {
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
