import { error } from '@sveltejs/kit';
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull, lt, ne, or } from 'drizzle-orm';
import {
	getBackend,
	type VmCreateParams,
	type VmCreateResult
} from '#lib/server/backends/index.js';
import { runInBackground } from '#lib/server/background.js';
import {
	deleteProjectServerEntity,
	ensureProjectServerEntity,
	isBillingConfigured
} from '#lib/server/billing/autumn.js';
import { createBillingMeter } from '#lib/server/billing/metering.js';
import { config } from '#lib/server/config.js';
import { closeRequestDb, type Database, initDrizzle } from '#lib/server/db/index.js';
import { baseImages, vms, vmTypes } from '#lib/server/db/schema.js';
import { ulid } from '#lib/server/id.js';
import {
	allocateVmNetworking,
	createVyosDelegatedRoute,
	ensureVmDelegatedRoute,
	generateMacAddress,
	releaseVmNetworking
} from '#lib/server/ipam.js';
import { applyDefaultPtrRecords } from '#lib/server/ptr-records.js';
import { allocateProxmoxVmid } from '#lib/server/vm-identity.js';
import { getRequestEvent } from '$app/server';

export interface ProvisionVmInput {
	billingExempt: boolean;
	imageId?: string;
	name: string;
	networkingMode?: 'both' | 'ipv6';
	password?: string;
	projectId: string;
	sshPublicKeys?: string[];
	userId: string;
	vmId?: string;
	vmTypeId: string;
}

export interface ProvisionedVm {
	id: string;
	taskId?: string;
}

const PROVISION_STALL_AFTER_MS = 60_000;
const PROVISION_UNSTARTED_AFTER_MS = 10 * 60_000;
const PROVISION_TIMEOUT_MS = 15 * 60_000;
const RESUME_LEASE_MS = 60_000;
const VM_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type VmRecord = InferSelectModel<typeof vms>;
export type StalledProvisioningVm = Pick<
	VmRecord,
	'id' | 'proxmoxId' | 'proxmoxNode' | 'backend' | 'status' | 'createdAt' | 'ownerProjectId'
> & { vmTypeStorageAmount: number | null };

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

export function isProvisioningStalled(row: StalledProvisioningVm, now = Date.now()) {
	if (row.status !== 'provisioning') {
		return false;
	}
	const stallAfterMs =
		row.proxmoxId === null ? PROVISION_UNSTARTED_AFTER_MS : PROVISION_STALL_AFTER_MS;
	return now - row.createdAt > stallAfterMs;
}

async function claimResumeLease(db: Database, vmId: string, claimedAt: number) {
	const claimed = await db
		.update(vms)
		.set({ provisioningResumeClaimedAt: claimedAt })
		.where(
			and(
				eq(vms.id, vmId),
				eq(vms.active, true),
				eq(vms.status, 'provisioning'),
				or(
					isNull(vms.provisioningResumeClaimedAt),
					lt(vms.provisioningResumeClaimedAt, claimedAt - RESUME_LEASE_MS)
				)
			)
		)
		.returning({ id: vms.id });
	return claimed.length > 0;
}

async function releaseResumeLease(db: Database, vmId: string, claimedAt: number) {
	await db
		.update(vms)
		.set({ provisioningResumeClaimedAt: null })
		.where(and(eq(vms.id, vmId), eq(vms.provisioningResumeClaimedAt, claimedAt)));
}

async function abandonUnstartedProvision(db: Database, row: StalledProvisioningVm) {
	const abandoned = await db
		.update(vms)
		.set({
			status: 'error',
			statusError: 'Provisioning was interrupted before the server was created'
		})
		.where(
			and(
				eq(vms.id, row.id),
				eq(vms.active, true),
				eq(vms.status, 'provisioning'),
				isNull(vms.proxmoxId)
			)
		)
		.returning({ id: vms.id });
	if (abandoned.length === 0) {
		return;
	}
	await releaseVmNetworking(db, row.id).catch((err) => {
		console.warn(`Failed to release networking for abandoned VM ${row.id}`, err);
	});
	if (row.ownerProjectId) {
		await deleteProjectServerEntity(row.ownerProjectId, row.id).catch((err) => {
			console.warn(`Failed to delete Autumn entity for abandoned VM ${row.id}`, err);
		});
	}
}

export async function resumeStalledProvisioning(db: Database, row: StalledProvisioningVm) {
	const claimedAt = Date.now();
	if (!(await claimResumeLease(db, row.id, claimedAt))) {
		return;
	}
	try {
		if (row.proxmoxId === null) {
			await abandonUnstartedProvision(db, row);
			return;
		}
		if (claimedAt - row.createdAt > PROVISION_TIMEOUT_MS) {
			await markVmProvisionFailed(row.id, 'Provisioning did not finish in time');
			return;
		}
		const provisioned = await getBackend(row.backend).finishProvisioning(
			row.id,
			row.proxmoxId ?? undefined,
			{ diskGb: row.vmTypeStorageAmount ?? 0 },
			{ proxmoxNode: row.proxmoxNode ?? undefined }
		);
		if (!provisioned) {
			return;
		}
		await ensureVmDelegatedRoute(db, row.id);
		await markVmProvisionReady(row.id);
	} catch (err) {
		console.warn(`Failed to resume provisioning for VM ${row.id}`, err);
	} finally {
		await releaseResumeLease(db, row.id, claimedAt).catch((err) => {
			console.warn(`Failed to release provisioning resume lease for VM ${row.id}`, err);
		});
	}
}

async function updateActiveVmStatus(
	vmId: string,
	values: { status: 'ready' } | { status: 'error'; statusError: string }
) {
	const columns =
		values.status === 'ready'
			? { ...values, lastKnownStatus: 'running', lastKnownUptime: 0, lastKnownAt: Date.now() }
			: values;
	const settledEvent = getRequestEvent();
	const ownsPool = !settledEvent.locals.db;
	const settledDb = initDrizzle();
	try {
		await settledDb
			.update(vms)
			.set(columns)
			.where(and(eq(vms.id, vmId), eq(vms.active, true), eq(vms.status, 'provisioning')));
		console.log(`VM ${vmId} provision ${values.status === 'ready' ? 'succeeded' : 'failed'}`);
	} catch (updateErr) {
		console.error(`VM ${vmId} status update failed:`, updateErr);
	} finally {
		if (ownsPool) {
			closeRequestDb(settledEvent);
		}
	}
}

function markVmProvisionReady(vmId: string) {
	return updateActiveVmStatus(vmId, { status: 'ready' });
}

function markVmProvisionFailed(vmId: string, statusError: string) {
	return updateActiveVmStatus(vmId, { status: 'error', statusError });
}

type NetworkingAllocations = Awaited<ReturnType<typeof allocateVmNetworking>>;

function buildVmNetworkConfig(
	networkingAllocations: NetworkingAllocations
): NonNullable<VmCreateParams['networkConfig']> {
	const ipv4NetworkAllocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv4' && allocation.address
	);
	const ipv6TransitNetworkAllocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv6' && allocation.address
	);
	const ipv6PrefixNetworkAllocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv6' && allocation.prefix
	);
	const firewallIpSet = [
		...(ipv4NetworkAllocation?.address ? [`${ipv4NetworkAllocation.address}/32`] : []),
		...(ipv6TransitNetworkAllocation?.address
			? [`${ipv6TransitNetworkAllocation.address}/128`]
			: []),
		...(ipv6PrefixNetworkAllocation?.prefix ? [ipv6PrefixNetworkAllocation.prefix] : [])
	];

	return {
		firewallIpSet,
		...(ipv4NetworkAllocation?.address
			? {
					ipv4: {
						address: ipv4NetworkAllocation.address,
						prefixLength: ipv4NetworkAllocation.prefixLength,
						gateway: ipv4NetworkAllocation.sourcePrefix.gatewayAddress ?? ''
					}
				}
			: {}),
		...(ipv6TransitNetworkAllocation?.address
			? {
					ipv6: {
						address: ipv6TransitNetworkAllocation.address,
						prefixLength: ipv6TransitNetworkAllocation.prefixLength
					}
				}
			: {}),
		...(ipv6PrefixNetworkAllocation?.prefix
			? { ipv6Prefix: ipv6PrefixNetworkAllocation.prefix }
			: {}),
		...(!ipv4NetworkAllocation &&
		(ipv6TransitNetworkAllocation?.address || ipv6PrefixNetworkAllocation?.prefix)
			? {
					nat64Prefix: config.vmNetwork.nat64Prefix,
					nat64Dns64Server: config.vmNetwork.nat64Dns64Server
				}
			: {})
	};
}

async function removeProxmoxVm(vmId: string, proxmoxId: number) {
	const backend = getBackend('proxmox');
	try {
		await backend.deleteVm(vmId, proxmoxId);
		const usedIds = await backend.listUsedProxmoxIds?.();
		return !usedIds?.has(proxmoxId);
	} catch (err) {
		console.warn(`Failed to remove Proxmox VM ${vmId} (${proxmoxId})`, err);
		return false;
	}
}

async function keepUnconfirmedProvision(db: Database, vmId: string) {
	console.error(
		`VM ${vmId} failed to provision and its Proxmox VM could not be confirmed removed; keeping the row for cleanup`
	);
	await db
		.update(vms)
		.set({
			status: 'error',
			statusError: 'Provisioning failed. Delete this server to finish cleaning it up.'
		})
		.where(and(eq(vms.id, vmId), eq(vms.active, true), ne(vms.status, 'deleting')))
		.catch((err) => {
			console.error(`VM ${vmId} failed provision status update failed:`, err);
		});
}

async function discardFailedProvisionRow(db: Database, vmId: string) {
	const released = await releaseVmNetworking(db, vmId).catch((err) => {
		console.warn(`Failed to release networking for failed VM ${vmId}`, err);
		return false;
	});
	const discard = released
		? db.delete(vms).where(eq(vms.id, vmId))
		: db
				.update(vms)
				.set({
					active: false,
					deletedAt: Date.now(),
					status: 'error',
					statusError: 'Provisioning failed'
				})
				.where(eq(vms.id, vmId));
	await discard.catch((err) => {
		console.error(`Failed to discard failed VM ${vmId}`, err);
	});
}

async function cleanUpFailedProvision(
	db: Database,
	params: {
		vmId: string;
		projectId: string;
		createdProxmoxId: number | null;
		delegatedRoute: Promise<unknown>;
	}
) {
	const { vmId, projectId, createdProxmoxId, delegatedRoute } = params;
	await delegatedRoute.catch(() => undefined);
	if (createdProxmoxId !== null && !(await removeProxmoxVm(vmId, createdProxmoxId))) {
		await keepUnconfirmedProvision(db, vmId);
		return;
	}
	await deleteProjectServerEntity(projectId, vmId).catch((err) => {
		console.warn(`Failed to delete Autumn entity for failed VM ${vmId}`, err);
	});
	await discardFailedProvisionRow(db, vmId);
}

async function claimProxmoxId(db: Database, vmId: string, proxmoxId: number) {
	const claimed = await db
		.update(vms)
		.set({ proxmoxId })
		.where(and(eq(vms.id, vmId), eq(vms.active, true), eq(vms.status, 'provisioning')))
		.returning({ id: vms.id });
	if (claimed.length === 0) {
		error(409, 'Server was deleted or failed before it could be created');
	}
}

async function recordProvisionedVm(
	db: Database,
	vmId: string,
	values: Pick<VmRecord, 'proxmoxId' | 'proxmoxNode' | 'lastKnownIpv4' | 'lastKnownIpv6'>
) {
	try {
		const recorded = await db
			.update(vms)
			.set(values)
			.where(and(eq(vms.id, vmId), eq(vms.active, true), ne(vms.status, 'deleting')))
			.returning({ id: vms.id });
		return recorded.length > 0;
	} catch (err) {
		console.error(`Failed to record provisioned VM ${vmId}`, err);
		return true;
	}
}

async function insertVmRow(db: Database, values: typeof vms.$inferInsert) {
	const [inserted] = await db
		.insert(vms)
		.values(values)
		.onConflictDoNothing({ target: vms.id })
		.returning({ id: vms.id });
	return inserted !== undefined;
}

async function findExistingProvision(
	db: Database,
	vmId: string,
	projectId: string
): Promise<ProvisionedVm | null> {
	const existing = await db.query.vms.findFirst({
		where: eq(vms.id, vmId),
		columns: { ownerProjectId: true, active: true, proxmoxId: true }
	});
	if (!existing) {
		return null;
	}
	if (existing.ownerProjectId !== projectId || !existing.active) {
		error(409, 'This create request was already used. Refresh the page and try again.');
	}
	return { id: vmId, taskId: existing.proxmoxId === null ? undefined : String(existing.proxmoxId) };
}

async function loadProvisionCatalog(db: Database, input: ProvisionVmInput) {
	const [vmType, baseImage] = await Promise.all([
		db.query.vmTypes.findFirst({
			where: eq(vmTypes.id, input.vmTypeId)
		}),
		input.imageId
			? db.query.baseImages.findFirst({
					where: eq(baseImages.id, input.imageId)
				})
			: null
	]);
	if (!vmType) {
		error(400, `VM type "${input.vmTypeId}" not found`);
	}
	if (isBillingConfigured() && !vmType.autumnFeatureId) {
		error(400, `VM type "${vmType.name}" is missing an Autumn feature ID`);
	}
	const featureId = vmType.autumnFeatureId;

	if (input.imageId && !baseImage) {
		error(400, `Image "${input.imageId}" not found`);
	}
	return { vmType, baseImage, featureId };
}

async function claimVmRow(
	db: Database,
	row: typeof vms.$inferInsert & { id: string; ownerProjectId: string }
): Promise<ProvisionedVm | null> {
	if (await insertVmRow(db, row)) {
		return null;
	}
	const existing = await findExistingProvision(db, row.id, row.ownerProjectId);
	if (existing) {
		return existing;
	}
	if (!(await insertVmRow(db, row))) {
		error(409, 'This create request is already in progress. Refresh the page to see it.');
	}
	return null;
}

export async function provisionVm(db: Database, input: ProvisionVmInput): Promise<ProvisionedVm> {
	const vmId = input.vmId ?? ulid();
	if (!VM_ID_PATTERN.test(vmId)) {
		error(400, 'Invalid create request ID');
	}
	const { vmType, baseImage, featureId } = await loadProvisionCatalog(db, input);

	const now = Date.now();
	const existing = await claimVmRow(db, {
		id: vmId,
		name: input.name,
		proxmoxId: null,
		active: true,
		ownerProjectId: input.projectId,
		vmTypeId: input.vmTypeId,
		creationDate: new Date().toISOString().split('T')[0],
		createdAt: now,
		backend: 'proxmox',
		status: 'provisioning'
	});
	if (existing) {
		return existing;
	}

	const macAddress = generateMacAddress();
	let networkingAllocations: Awaited<ReturnType<typeof allocateVmNetworking>> = [];
	let delegatedRoute: Promise<unknown> = Promise.resolve();
	let createdProxmoxId: number | null = null;
	let result: VmCreateResult;
	try {
		if (!input.billingExempt) {
			await ensureProjectServerEntity({
				projectId: input.projectId,
				serverId: vmId,
				name: input.name
			});
		}
		networkingAllocations = await allocateVmNetworking(db, {
			vmId,
			macAddress,
			mode: input.networkingMode ?? 'both'
		});
		const networkConfig = buildVmNetworkConfig(networkingAllocations);
		delegatedRoute = createVyosDelegatedRoute(networkingAllocations, vmId, db).catch(
			async (err) => {
				await markVmProvisionFailed(vmId, `Failed to create IPv6 route: ${errorMessage(err)}`);
				throw err;
			}
		);
		runInBackground(delegatedRoute, `create delegated IPv6 route for VM ${vmId}`);
		const backend = getBackend('proxmox');
		const proxmoxId = await allocateProxmoxVmid(db, backend);
		await claimProxmoxId(db, vmId, proxmoxId);
		createdProxmoxId = proxmoxId;
		result = await backend.createVm({
			id: vmId,
			name: input.name,
			proxmoxId,
			macAddress,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			imageId: input.imageId,
			imageSource: baseImage?.filePath,
			secureBoot: baseImage?.secureBoot ?? true,
			networkConfig,
			sshKeys: input.sshPublicKeys ?? [],
			password: input.password,
			onProvisionSettled: async ({ ok, error: err }) => {
				if (!ok) {
					await markVmProvisionFailed(vmId, err ?? 'Unknown error');
					return;
				}
				try {
					await delegatedRoute;
				} catch {
					return;
				}
				await markVmProvisionReady(vmId);
			},
			registerBackground: runInBackground,
			userId: input.userId,
			projectId: input.projectId
		});

		if (!result.macAddress) {
			error(502, 'Proxmox did not return a MAC address');
		}
	} catch (err) {
		await cleanUpFailedProvision(db, {
			vmId,
			projectId: input.projectId,
			createdProxmoxId,
			delegatedRoute
		});
		throw err;
	}

	const ipv4Allocation = networkingAllocations.find((allocation) => allocation.family === 'ipv4');
	const ipv6Allocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv6' && allocation.address
	);

	const liveProxmoxId = result.proxmoxId ?? createdProxmoxId;
	const stillWanted = await recordProvisionedVm(db, vmId, {
		proxmoxId: liveProxmoxId,
		proxmoxNode: result.proxmoxNode ?? null,
		lastKnownIpv4: ipv4Allocation?.address ?? null,
		lastKnownIpv6: ipv6Allocation?.address ?? null
	});
	if (!stillWanted) {
		if (liveProxmoxId !== null && !(await removeProxmoxVm(vmId, liveProxmoxId))) {
			await keepUnconfirmedProvision(db, vmId);
		}
		error(409, 'Server was deleted while it was being created');
	}

	runInBackground(
		applyDefaultPtrRecords(db, networkingAllocations),
		`apply default PTR records for VM ${vmId}`
	);
	if (featureId) {
		await createBillingMeter({
			projectId: input.projectId,
			resourceType: 'vm',
			resourceId: vmId,
			featureId,
			units: 1,
			now
		}).catch((err) => {
			console.error(
				`Failed to create billing meter for VM ${vmId}; reconcileMissingMeters will reseed it`,
				err
			);
		});
	}

	return { id: vmId, taskId: result.taskId };
}
