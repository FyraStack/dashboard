import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getBackend, type VmCreateParams } from '#lib/server/backends/index.js';
import {
	deleteProjectServerEntity,
	ensureProjectServerEntity,
	isBillingConfigured
} from '#lib/server/billing/autumn.js';
import { createBillingMeter } from '#lib/server/billing/metering.js';
import { config } from '#lib/server/config.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { baseImages, vms, vmTypes } from '#lib/server/db/schema.js';
import { errorMessage } from '#lib/server/errors.js';
import { error } from '#lib/server/http.js';
import {
	allocateVmNetworking,
	ensureVmDelegatedRoute,
	generateMacAddress,
	releaseVmNetworking,
	vmAllocations
} from '#lib/server/ipam.js';
import { applyDefaultPtrRecords } from '#lib/server/ptr-records.js';
import { inSystemScope } from '#lib/server/scope.js';
import { allocateProxmoxVmid } from '#lib/server/vm-identity.js';

export interface ProvisionVmInput {
	billingExempt: boolean;
	imageId?: string;
	name: string;
	networkingMode?: 'both' | 'ipv6';
	password?: string;
	projectId: string;
	sshPublicKeys?: string[];
	userId: string;
	vmTypeId: string;
}

interface ProvisioningVm {
	backend: 'proxmox';
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

async function cleanUpFailedProvision(
	db: Database,
	params: { vmId: string; projectId: string; proxmoxId: number | null }
) {
	const { vmId, projectId, proxmoxId } = params;
	if (proxmoxId !== null) {
		await getBackend('proxmox')
			.deleteVm(vmId, proxmoxId)
			.catch((deleteErr) => {
				console.warn(`Failed to clean up Proxmox VM ${vmId} after provisioning error`, deleteErr);
			});
	}
	await releaseVmNetworking(db, vmId).catch(() => undefined);
	await deleteProjectServerEntity(projectId, vmId).catch(() => undefined);
	await db
		.delete(vms)
		.where(eq(vms.id, vmId))
		.catch(() => undefined);
}

export async function provisionVm(db: Database, input: ProvisionVmInput) {
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
		const backend = getBackend('proxmox');
		proxmoxId = await allocateProxmoxVmid(db, backend);
		await db.update(vms).set({ proxmoxId }).where(eq(vms.id, vmId));
		const created = await backend.createVm({
			id: vmId,
			name: input.name,
			proxmoxId,
			macAddress,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			tierName: vmType.name,
			imageId: input.imageId,
			imageSource: baseImage?.filePath,
			secureBoot: baseImage?.secureBoot ?? true,
			networkConfig,
			sshKeys: input.sshPublicKeys ?? [],
			password: input.password,
			userId: input.userId,
			projectId: input.projectId
		});

		const ipv4Allocation = networkingAllocations.find((allocation) => allocation.family === 'ipv4');
		const ipv6Allocation = networkingAllocations.find(
			(allocation) => allocation.family === 'ipv6' && allocation.address
		);
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
				backend: 'proxmox',
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

export class VmProvisioningWorkflow extends WorkflowEntrypoint<Env, ProvisioningVm> {
	async run(event: WorkflowEvent<ProvisioningVm>, step: WorkflowStep) {
		const vm = event.payload;
		const backend = () => getBackend(vm.backend);

		try {
			const importTaskId = await step.do(
				'configure vm',
				{
					retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
					timeout: '5 minutes'
				},
				() =>
					inSystemScope(() =>
						backend().configureVm({
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
							backend().waitForTask(vm.proxmoxNode, importTaskId, DISK_IMPORT_TIMEOUT_MS)
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
						backend().finishProvisioning(vm.id, vm.proxmoxId, { diskGb: vm.diskGb })
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
