import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { and, eq, sql } from 'drizzle-orm';
import type { NetworkingMode } from 'stack-shared/compute';
import { proxmox, type VmCreateParams } from '#lib/server/backends/index.js';
import { isBillingConfigured } from '#lib/server/billing/autumn.js';
import {
	deleteProjectServerEntity,
	ensureProjectServerEntity
} from '#lib/server/billing/entities.js';
import { createBillingMeter } from '#lib/server/billing/metering.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { baseImages, sshKeys, vms, vmTypes } from '#lib/server/db/schema.js';
import { errorMessage } from '#lib/server/errors.js';
import { error } from '#lib/server/http.js';
import {
	allocateVmNetworking,
	ensureVmDelegatedRoute,
	findIpv4Allocation,
	findIpv6PrefixAllocation,
	findIpv6TransitAllocation,
	generateMacAddress,
	releaseVmNetworking,
	vmAllocations
} from '#lib/server/ipam.js';
import { applyDefaultPtrRecords } from '#lib/server/ptr-records.js';
import { inSystemScope } from '#lib/server/scope.js';

async function nextSequenceValue(db: Database): Promise<number> {
	const result = await db.execute(sql`select nextval('proxmox_vmid_seq') as "vmid"`);
	return Number((result.rows[0] as { vmid: string | number }).vmid);
}

async function allocateProxmoxVmid(db: Database): Promise<number> {
	const usedIds = await proxmox().listUsedProxmoxIds();
	let candidate = await nextSequenceValue(db);
	while (usedIds.has(candidate)) {
		// biome-ignore lint/performance/noAwaitInLoops: each sequence value is only drawn after the previous candidate was found taken
		candidate = await nextSequenceValue(db);
	}
	return candidate;
}

interface ProvisionVmInput {
	billingExempt: boolean;
	imageId?: string;
	name: string;
	networkingMode?: NetworkingMode;
	password?: string;
	projectId: string;
	sshPublicKeys?: string[];
	userId: string;
	vmTypeId: string;
}

export interface RequestedVm {
	imageId?: string;
	name: string;
	networkingMode?: NetworkingMode;
	password?: string;
	projectId: string;
	sshKeyIds?: string[];
	vmTypeId: string;
}

interface ProvisioningVm {
	createTaskId: string;
	diskGb: number;
	firewallIpSet: string[];
	id: string;
	imageSource: string | null;
	proxmoxId: number;
	proxmoxNode: string;
}

const DISK_IMPORT_TIMEOUT_MS = 20 * 60_000;

async function settleProvisioningVm(
	vmId: string,
	values: { status: 'ready' } | { status: 'error'; statusError: string }
): Promise<boolean> {
	const columns =
		values.status === 'ready'
			? { ...values, lastKnownStatus: 'running', lastKnownUptime: 0, lastKnownAt: Date.now() }
			: values;
	const updated = await initDrizzle()
		.update(vms)
		.set(columns)
		.where(and(eq(vms.id, vmId), eq(vms.active, true), eq(vms.status, 'provisioning')))
		.returning({ id: vms.id });
	console.log(`VM ${vmId} provision ${values.status === 'ready' ? 'succeeded' : 'failed'}`);
	return updated.length > 0;
}

type NetworkingAllocations = Awaited<ReturnType<typeof allocateVmNetworking>>;

function buildVmNetworkConfig(
	networkingAllocations: NetworkingAllocations
): NonNullable<VmCreateParams['networkConfig']> {
	const ipv4NetworkAllocation = findIpv4Allocation(networkingAllocations);
	const ipv6TransitNetworkAllocation = findIpv6TransitAllocation(networkingAllocations);
	const ipv6PrefixNetworkAllocation = findIpv6PrefixAllocation(networkingAllocations);
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
			: {})
	};
}

async function cleanUpFailedProvision(
	db: Database,
	params: { vmId: string; projectId: string; proxmoxId: number | null }
) {
	const { vmId, projectId, proxmoxId } = params;
	const logFailure = (step: string) => (cleanupErr: unknown) => {
		console.warn(`Failed to ${step} for VM ${vmId} after provisioning error`, cleanupErr);
	};
	if (proxmoxId !== null) {
		await proxmox().deleteVm(vmId, proxmoxId).catch(logFailure('clean up Proxmox VM'));
	}
	await releaseVmNetworking(db, vmId).catch(logFailure('release networking'));
	await deleteProjectServerEntity(projectId, vmId).catch(logFailure('delete billing entity'));
	await db.delete(vms).where(eq(vms.id, vmId)).catch(logFailure('delete VM row'));
}

async function provisionVm(db: Database, input: ProvisionVmInput) {
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

	const now = Date.now();
	const [inserted] = await db
		.insert(vms)
		.values({
			name: input.name,
			proxmoxId: null,
			active: true,
			ownerProjectId: input.projectId,
			vmTypeId: input.vmTypeId,
			creationDate: new Date().toISOString().split('T')[0],
			createdAt: now,
			backend: 'proxmox',
			status: 'provisioning'
		})
		.returning();

	const vmId = inserted.id;
	const macAddress = generateMacAddress();
	let proxmoxId: number | null = null;
	try {
		if (!input.billingExempt) {
			await ensureProjectServerEntity({
				projectId: input.projectId,
				serverId: vmId,
				name: input.name
			});
		}
		const networkingAllocations = await allocateVmNetworking(db, {
			vmId,
			macAddress,
			mode: input.networkingMode ?? 'both'
		});
		const networkConfig = buildVmNetworkConfig(networkingAllocations);
		proxmoxId = await allocateProxmoxVmid(db);
		await db.update(vms).set({ proxmoxId }).where(eq(vms.id, vmId));
		const created = await proxmox().createVm({
			id: vmId,
			name: input.name,
			proxmoxId,
			macAddress,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			tierName: vmType.name,
			imageSource: baseImage?.filePath,
			secureBoot: baseImage?.secureBoot ?? true,
			networkConfig,
			sshKeys: input.sshPublicKeys ?? [],
			password: input.password,
			userId: input.userId,
			projectId: input.projectId
		});

		const ipv4Allocation = findIpv4Allocation(networkingAllocations);
		const ipv6Allocation = findIpv6TransitAllocation(networkingAllocations);
		await db
			.update(vms)
			.set({
				proxmoxId: created.proxmoxId,
				proxmoxNode: created.proxmoxNode,
				lastKnownIpv4: ipv4Allocation?.address ?? null,
				lastKnownIpv6: ipv6Allocation?.address ?? null
			})
			.where(eq(vms.id, vmId));

		await env.VM_PROVISIONING.create({
			id: vmId,
			params: {
				createTaskId: created.taskId,
				diskGb: vmType.storageAmount,
				firewallIpSet: networkConfig.firewallIpSet ?? [],
				id: vmId,
				imageSource: baseImage?.filePath ?? null,
				proxmoxId: created.proxmoxId,
				proxmoxNode: created.proxmoxNode
			}
		});
	} catch (err) {
		await cleanUpFailedProvision(db, { vmId, projectId: input.projectId, proxmoxId });
		throw err;
	}

	if (featureId) {
		await createBillingMeter({
			projectId: input.projectId,
			resourceType: 'vm',
			resourceId: vmId,
			featureId,
			units: 1,
			now
		});
	}

	return { id: vmId };
}

async function resolveSshPublicKeys(
	db: Database,
	keyOwnerId: string | undefined,
	sshKeyIds: string[]
) {
	if (sshKeyIds.length === 0 || !keyOwnerId) {
		return [];
	}

	const keys = await db.query.sshKeys.findMany({ where: eq(sshKeys.userId, keyOwnerId) });
	return keys.filter((key) => sshKeyIds.includes(key.id)).map((key) => key.publicKey);
}

export async function provisionRequestedVm(
	db: Database,
	request: RequestedVm,
	options: { billingExempt: boolean; keyOwnerId: string | undefined; userId: string }
) {
	const sshPublicKeys = await resolveSshPublicKeys(db, options.keyOwnerId, request.sshKeyIds ?? []);
	const created = await provisionVm(db, {
		projectId: request.projectId,
		vmTypeId: request.vmTypeId,
		name: request.name,
		userId: options.userId,
		billingExempt: options.billingExempt,
		networkingMode: request.networkingMode,
		imageId: request.imageId,
		sshPublicKeys,
		password: request.password
	});
	return { created, sshKeyCount: sshPublicKeys.length };
}

export class VmProvisioningWorkflow extends WorkflowEntrypoint<Env, ProvisioningVm> {
	async run(event: WorkflowEvent<ProvisioningVm>, step: WorkflowStep) {
		const vm = event.payload;

		try {
			const importTaskId = await step.do(
				'configure vm',
				{
					retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
					timeout: '5 minutes'
				},
				() =>
					inSystemScope(() =>
						proxmox().configureVm({
							createTaskId: vm.createTaskId,
							firewallIpSet: vm.firewallIpSet,
							imageSource: vm.imageSource,
							proxmoxId: vm.proxmoxId,
							proxmoxNode: vm.proxmoxNode
						})
					)
			);
			if (importTaskId) {
				await step.do(
					'wait for disk import',
					{
						retries: { limit: 3, delay: '30 seconds', backoff: 'constant' },
						timeout: '30 minutes'
					},
					() =>
						inSystemScope(() =>
							proxmox().waitForTask(vm.proxmoxNode, importTaskId, DISK_IMPORT_TIMEOUT_MS)
						)
				);
			}
			await step.do(
				'start vm',
				{
					retries: { limit: 5, delay: '15 seconds', backoff: 'exponential' },
					timeout: '15 minutes'
				},
				() =>
					inSystemScope(() =>
						proxmox().finishProvisioning(vm.id, vm.proxmoxId, { diskGb: vm.diskGb })
					)
			);
			await step.do('create delegated route', () =>
				inSystemScope(() => ensureVmDelegatedRoute(initDrizzle(), vm.id))
			);
		} catch (err) {
			const statusError = errorMessage(err);
			await step.do('mark provisioning failed', () =>
				inSystemScope(() => settleProvisioningVm(vm.id, { status: 'error', statusError }))
			);
			throw err;
		}

		const ready = await step.do('mark vm ready', () =>
			inSystemScope(() => settleProvisioningVm(vm.id, { status: 'ready' }))
		);
		if (!ready) {
			return;
		}
		await step.do('apply default ptr records', () =>
			inSystemScope(async () => {
				const db = initDrizzle();
				await applyDefaultPtrRecords(db, await vmAllocations(db, vm.id));
			})
		);
	}
}
