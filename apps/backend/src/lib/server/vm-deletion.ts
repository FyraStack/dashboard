import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { getBackend } from '#lib/server/backends/index.js';
import { deleteProjectServerEntity } from '#lib/server/billing/autumn.js';
import { hasUnsyncedUsageEvents, meterResourceThrough } from '#lib/server/billing/metering.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { ipAssignments, paymentPeriods, vms, volumes } from '#lib/server/db/schema.js';
import { releaseVmNetworking } from '#lib/server/ipam.js';
import { inSystemScope } from '#lib/server/scope.js';

interface DeletableVm {
	backend: 'proxmox';
	id: string;
	ownerProjectId: string | null;
	proxmoxId: number | null;
}

export async function queueVmDeletion(db: Database, row: DeletableVm): Promise<void> {
	await meterResourceThrough('vm', row.id).catch((err) => {
		console.warn(`Failed to close billing meter for VM ${row.id} before deletion`, err);
	});
	await db.update(vms).set({ status: 'deleting', statusError: null }).where(eq(vms.id, row.id));
	await env.VM_DELETION.create({
		id: `${row.id}-${Date.now()}`,
		params: {
			backend: row.backend,
			id: row.id,
			ownerProjectId: row.ownerProjectId,
			proxmoxId: row.proxmoxId
		}
	});
}

async function stopProvisioning(vmId: string) {
	try {
		const provisioning = await env.VM_PROVISIONING.get(vmId);
		const { status } = await provisioning.status();
		if (
			status === 'queued' ||
			status === 'running' ||
			status === 'waiting' ||
			status === 'paused'
		) {
			await provisioning.terminate();
		}
	} catch (err) {
		console.warn(`Failed to stop provisioning workflow for VM ${vmId}`, err);
	}
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

async function markVmDeletionFailed(vmId: string, statusError: string) {
	await initDrizzle().update(vms).set({ status: 'error', statusError }).where(eq(vms.id, vmId));
}

async function releaseDeletedVmResources(row: DeletableVm): Promise<void> {
	const db = initDrizzle();
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
}

export class VmDeletionWorkflow extends WorkflowEntrypoint<Env, DeletableVm> {
	async run(event: WorkflowEvent<DeletableVm>, step: WorkflowStep) {
		const row = event.payload;

		await step.do('stop provisioning', () => stopProvisioning(row.id));

		try {
			await step.do(
				'deprovision backend vm',
				{
					retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' },
					timeout: '15 minutes'
				},
				() =>
					inSystemScope(() => getBackend(row.backend).deleteVm(row.id, row.proxmoxId ?? undefined))
			);
		} catch (err) {
			const statusError = err instanceof Error ? err.message : 'Failed to deprovision VM';
			await step.do('mark deletion failed', () =>
				inSystemScope(() => markVmDeletionFailed(row.id, statusError))
			);
			throw err;
		}

		await step.do('release vm resources', () =>
			inSystemScope(() => releaseDeletedVmResources(row))
		);
	}
}
