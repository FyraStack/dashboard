import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { runInBackground } from '$lib/server/background';
import { getBackend } from '$lib/server/backends';
import {
	deleteProjectServerEntity,
	ensureProjectServerEntity,
	isBillingConfigured
} from '$lib/server/billing/autumn';
import { createBillingMeter } from '$lib/server/billing/metering';
import { closeRequestDb, initDrizzle, type Database } from '$lib/server/db';
import { baseImages, vms, vmTypes } from '$lib/server/db/schema';
import { allocateVmNetworking, generateMacAddress, releaseVmNetworking } from '$lib/server/ipam';

export type ProvisionVmInput = {
	projectId: string;
	vmTypeId: string;
	name: string;
	userId: string;
	billingExempt: boolean;
	networkingMode?: 'both' | 'ipv6';
	imageId?: string;
	sshPublicKeys?: string[];
	password?: string;
};

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
	if (!vmType) error(400, `VM type "${input.vmTypeId}" not found`);
	if (isBillingConfigured() && !vmType.autumnFeatureId)
		error(400, `VM type "${vmType.name}" is missing an Autumn feature ID`);
	const featureId = vmType.autumnFeatureId;

	if (input.imageId && !baseImage) error(400, `Image "${input.imageId}" not found`);

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
	let networkingAllocations: Awaited<ReturnType<typeof allocateVmNetworking>> = [];
	let result;
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
		const backend = getBackend('proxmox');
		result = await backend.createVm({
			id: vmId,
			name: input.name,
			proxmoxId: inserted.proxmoxId ?? undefined,
			macAddress,
			cores: vmType.cores,
			memoryMb: vmType.ramCapacity,
			diskGb: vmType.storageAmount,
			imageId: input.imageId,
			imageSource: baseImage?.filePath,
			secureBoot: baseImage?.secureBoot ?? true,
			networkConfig: {
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
			},
			sshKeys: input.sshPublicKeys ?? [],
			password: input.password,
			onProvisionSettled: async ({ ok, error: err }) => {
				const settledEvent = getRequestEvent();
				const settledDb = initDrizzle();
				try {
					await settledDb
						.update(vms)
						.set(
							ok ? { status: 'ready' } : { status: 'error', statusError: err ?? 'Unknown error' }
						)
						.where(and(eq(vms.id, vmId), eq(vms.active, true)));
					console.log(`VM ${vmId} provision ${ok ? 'succeeded' : 'failed'}`);
				} catch (updateErr) {
					console.error(`VM ${vmId} status update failed:`, updateErr);
				} finally {
					closeRequestDb(settledEvent);
				}
			},
			registerBackground: runInBackground,
			userId: input.userId,
			projectId: input.projectId
		});

		if (!result.macAddress) error(502, 'Proxmox did not return a MAC address');
	} catch (err) {
		if (result?.proxmoxId != null) {
			await getBackend('proxmox')
				.deleteVm(vmId, result.proxmoxId)
				.catch((deleteErr) => {
					console.warn(`Failed to clean up Proxmox VM ${vmId} after provisioning error`, deleteErr);
				});
		}
		await releaseVmNetworking(db, vmId).catch(() => {});
		await deleteProjectServerEntity(input.projectId, vmId).catch(() => {});
		await db
			.delete(vms)
			.where(eq(vms.id, inserted.id))
			.catch(() => {});
		throw err;
	}

	const ipv4Allocation = networkingAllocations.find((allocation) => allocation.family === 'ipv4');
	const ipv6Allocation = networkingAllocations.find(
		(allocation) => allocation.family === 'ipv6' && allocation.address
	);

	await db
		.update(vms)
		.set({
			proxmoxId: result.proxmoxId ?? null,
			proxmoxNode: result.proxmoxNode ?? null,
			lastKnownIpv4: ipv4Allocation?.address ?? null,
			lastKnownIpv6: ipv6Allocation?.address ?? null
		})
		.where(eq(vms.id, vmId));
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

	return { id: inserted.id, taskId: result.taskId };
}
