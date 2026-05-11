import { eq } from 'drizzle-orm';
import { initDrizzle } from '$lib/server/db';
import { vms } from '$lib/server/db/schema';
import { getRuntimeEnv } from '$lib/server/env';
import { getBackend, type VmInfo } from '$lib/server/backends';

const CACHE_KEY = 'proxmox:vms';
const CACHE_TTL_SECONDS = 15;
const STALE_TTL_MS = 5 * 60 * 1000;

type VmLiveSnapshot = {
	vms: VmInfo[];
	fetchedAt: number;
};

let inFlight: Promise<VmInfo[]> | null = null;
let memorySnapshot: VmLiveSnapshot | null = null;

function getFirstIp(
	networkInterfaces: VmInfo['networkInterfaces'] | null | undefined,
	match: (address: string) => boolean
): string | null {
	return (
		Object.values(networkInterfaces ?? {})
			.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
			.find((address) => address && match(address)) ?? null
	);
}

async function readSnapshot(): Promise<VmLiveSnapshot | null> {
	const kv = getRuntimeEnv().PROXMOX_CACHE;

	if (kv) {
		const snapshot = await kv.get<VmLiveSnapshot>(CACHE_KEY, { type: 'json' });
		if (snapshot) return snapshot;
	}

	return memorySnapshot;
}

async function writeSnapshot(vms: VmInfo[]) {
	const snapshot = { vms, fetchedAt: Date.now() };
	memorySnapshot = snapshot;

	const kv = getRuntimeEnv().PROXMOX_CACHE;
	if (kv) {
		await kv.put(CACHE_KEY, JSON.stringify(snapshot), { expirationTtl: STALE_TTL_MS / 1000 });
	}
}

async function persistKnownState(liveVms: VmInfo[]) {
	const db = initDrizzle();

	await Promise.all(
		liveVms.map((vm) => {
			if (vm.proxmoxId == null) return null;

			return db
				.update(vms)
				.set({
					lastKnownIpv4: getFirstIp(
						vm.networkInterfaces,
						(address) => !address.startsWith('127.') && !address.includes(':')
					),
					lastKnownIpv6: getFirstIp(vm.networkInterfaces, (address) => address.includes(':')),
					lastKnownStatus: vm.status,
					lastKnownUptime: vm.uptime,
					lastKnownAt: Date.now()
				})
				.where(eq(vms.proxmoxId, vm.proxmoxId));
		})
	);
}

export async function refreshProxmoxVmCache(): Promise<VmInfo[]> {
	if (inFlight) return inFlight;

	inFlight = getBackend('proxmox')
		.listVms()
		.then(async (liveVms) => {
			await writeSnapshot(liveVms);
			await persistKnownState(liveVms);
			return liveVms;
		})
		.finally(() => {
			inFlight = null;
		});

	return inFlight;
}

export async function getCachedProxmoxVms(options: { force?: boolean } = {}): Promise<VmInfo[]> {
	if (!options.force) {
		const snapshot = await readSnapshot();

		if (snapshot && Date.now() - snapshot.fetchedAt < CACHE_TTL_SECONDS * 1000) {
			return snapshot.vms;
		}
	}

	return refreshProxmoxVmCache();
}
