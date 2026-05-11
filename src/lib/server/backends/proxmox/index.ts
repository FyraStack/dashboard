import { HTTPError } from 'ky';
import { ProxmoxClient } from './client';
import type { PveClusterResource } from './types';
import type {
	BackendImage,
	BackendImageImportTarget,
	BackendImageImportParams,
	VmBackend,
	VmInfo,
	VmCreateParams,
	VmCreateResult,
	VmStatus
} from '../types';

interface ResolvedVm {
	node: string;
	vmid: number;
}

export class ProxmoxBackend implements VmBackend {
	readonly name = 'proxmox' as const;
	private client: ProxmoxClient;

	constructor(client: ProxmoxClient) {
		this.client = client;
	}

	private mapStatus(status: string): VmStatus {
		switch (status) {
			case 'running':
				return 'running';
			case 'stopped':
				return 'stopped';
			case 'paused':
				return 'paused';
			default:
				return 'unknown';
		}
	}

	private async resolve(id: string, proxmoxId?: number): Promise<ResolvedVm> {
		const resources = await this.client.getClusterResources('vm');
		const match = resources.find(
			(r) => r.type === 'qemu' && (proxmoxId != null ? r.vmid === proxmoxId : r.name === id)
		);

		if (!match || !match.node || match.vmid == null) {
			throw new Error(
				proxmoxId != null
					? `VM with Proxmox ID "${proxmoxId}" not found on any Proxmox node`
					: `VM "${id}" not found on any Proxmox node`
			);
		}

		return { node: match.node, vmid: match.vmid };
	}

	private resourceToInfo(r: PveClusterResource): VmInfo {
		const memoryUsage = r.mem != null && r.maxmem ? r.mem / r.maxmem : undefined;
		const diskUsage = r.disk != null && r.maxdisk ? r.disk / r.maxdisk : undefined;

		return {
			id: r.name ?? String(r.vmid),
			proxmoxId: r.vmid,
			name: r.name ?? `VM ${r.vmid}`,
			status: this.mapStatus(r.status ?? 'unknown'),
			cores: r.maxcpu ?? 0,
			memory: r.maxmem ?? 0,
			disk: r.maxdisk ?? 0,
			uptime: r.uptime ?? 0,
			metrics: {
				cpu: r.cpu,
				memory: memoryUsage,
				disk: diskUsage
			}
		};
	}

	private storageSupportsContent(content: string | undefined, target: string): boolean {
		return (content ?? '')
			.split(',')
			.map((value) => value.trim())
			.includes(target);
	}

	private isActiveImportStorage(storage: { content?: string; active?: 0 | 1; enabled?: 0 | 1 }) {
		return (
			this.storageSupportsContent(storage.content, 'import') &&
			storage.active !== 0 &&
			storage.enabled !== 0
		);
	}

	async listVms(): Promise<VmInfo[]> {
		const resources = await this.client.getClusterResources('vm');
		return resources.filter((r) => r.type === 'qemu').map((r) => this.resourceToInfo(r));
	}

	async listImages(): Promise<BackendImage[]> {
		const nodes = await this.client.listNodes();
		const nodeImages = await Promise.all(
			nodes.map(async (node) => {
				const storages = await this.client.listStorage(node.node);
				const importStorages = storages.filter((storage) => this.isActiveImportStorage(storage));

				const storageImages = await Promise.all(
					importStorages.map(async (storage) => {
						const contents = await this.client.listStorageContent(
							node.node,
							storage.storage,
							'import'
						);

						return contents.map((item) => {
							const parts = item.volid.split('/');
							return {
								volid: item.volid,
								filename: parts.at(-1) ?? item.volid,
								size: item.size,
								node: node.node,
								storage: storage.storage,
								content: 'import' as const,
								format: item.format
							};
						});
					})
				);

				return storageImages.flat();
			})
		);
		const seen = new Set<string>();
		const results: BackendImage[] = [];

		for (const image of nodeImages.flat()) {
			if (seen.has(image.volid)) continue;
			seen.add(image.volid);
			results.push(image);
		}

		return results;
	}

	async listImageImportTargets(): Promise<BackendImageImportTarget[]> {
		const nodes = await this.client.listNodes();
		const onlineNodes = nodes.filter((node) => node.status === 'online');
		const targets = await Promise.all(
			onlineNodes.map(async (node) => {
				const storages = await this.client.listStorage(node.node);
				return storages
					.filter((storage) => this.isActiveImportStorage(storage))
					.map((storage) => ({ node: node.node, storage: storage.storage }));
			})
		);

		return targets.flat();
	}

	async importImageFromUrl(params: BackendImageImportParams): Promise<string> {
		return this.client.importStorageContentFromUrl(params.node, params.storage, {
			url: params.url,
			filename: params.filename,
			content: 'import',
			checksum: params.checksum,
			checksumAlgorithm: params.checksumAlgorithm,
			verifyCertificates: params.verifyCertificates
		});
	}

	async getTaskStatus(node: string, upid: string) {
		const status = await this.client.getTaskStatus(node, upid);
		return { status: status.status, exitstatus: status.exitstatus };
	}

	async getVm(id: string, proxmoxId?: number): Promise<VmInfo> {
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const status = await this.client.getQemuVm(node, vmid);

		let networkInterfaces: VmInfo['networkInterfaces'] | undefined;
		if (status.status === 'running') {
			try {
				const ifaces = await this.client.getNetworkInterfaces(node, vmid);
				networkInterfaces = {};
				for (const iface of ifaces) {
					networkInterfaces[iface.name] = {
						ipAddresses: iface['ip-addresses']?.map((a) => a['ip-address'])
					};
				}
			} catch {
				// guest agent may not be installed
			}
		}

		const memoryUsage =
			status.mem != null && status.maxmem ? status.mem / status.maxmem : undefined;
		const diskUsage =
			status.disk != null && status.maxdisk ? status.disk / status.maxdisk : undefined;

		return {
			id,
			proxmoxId: vmid,
			name: status.name ?? `VM ${status.vmid}`,
			status: this.mapStatus(status.status),
			cores: status.cpus ?? 0,
			memory: status.maxmem ?? 0,
			disk: status.maxdisk ?? 0,
			uptime: status.uptime ?? 0,
			networkInterfaces,
			metrics: {
				cpu: status.cpu,
				memory: memoryUsage,
				disk: diskUsage,
				networkIn: status.netin,
				networkOut: status.netout,
				diskRead: status.diskread,
				diskWrite: status.diskwrite
			}
		};
	}

	async createVm(params: VmCreateParams): Promise<VmCreateResult> {
		const [nodes, vmid] = await Promise.all([this.client.listNodes(), this.client.getNextVmId()]);

		// Pick the online node with the most free memory
		const online = nodes.filter((n) => n.status === 'online');
		if (!online.length) throw new Error('No online Proxmox nodes available');
		const node = online.sort((a, b) => b.maxmem - b.mem - (a.maxmem - a.mem))[0];

		const sshKeysEncoded = params.sshKeys
			? encodeURIComponent(params.sshKeys.join('\n'))
			: undefined;
		const cloudInitAuth =
			sshKeysEncoded || params.password
				? {
						ciuser: 'root',
						...(sshKeysEncoded ? { sshkeys: sshKeysEncoded } : {}),
						...(params.password ? { cipassword: params.password } : {}),
						ipconfig0: 'ip=dhcp'
					}
				: {};
		const bootDisk = 'virtio0';

		// Phase 1 — create the VM shell (no boot disk yet, returns instantly)
		await this.client.createQemuVm(node.node, {
			vmid,
			name: params.name,
			cores: params.cores,
			sockets: 1,
			memory: params.memoryMb,
			cpu: 'x86-64-v3',
			ostype: 'l26',
			bios: 'ovmf',
			machine: 'q35',
			efidisk0: 'local-lvm:0,efitype=4m,pre-enrolled-keys=1',
			scsihw: 'virtio-scsi-single',
			...(params.imageSource ? {} : { virtio0: `local-lvm:${params.diskGb}` }),
			net0: 'virtio,bridge=vmbr0',
			boot: `order=${bootDisk}`,
			serial0: 'socket',
			agent: '1'
		});

		// Phase 2 — import cloud image as boot disk (runs in background)
		if (params.imageSource) {
			const importUpid = await this.client.updateQemuConfigAsync(node.node, vmid, {
				virtio0: `local-lvm:0,import-from=${params.imageSource}`
			});

			this.client
				.waitForTask(node.node, importUpid)
				.then(async () => {
					const cloudInitUpid = await this.client.updateQemuConfigAsync(node.node, vmid, {
						ide2: 'local-lvm:cloudinit',
						boot: `order=${bootDisk}`,
						...cloudInitAuth
					});
					await this.client.waitForTask(node.node, cloudInitUpid);
					if (params.diskGb > 0) {
						await this.client.resizeDisk(node.node, vmid, 'virtio0', `${params.diskGb}G`);
					}
					const startUpid = await this.client.startVm(node.node, vmid);
					await this.client.waitForTask(node.node, startUpid);
					params.onProvisionSettled?.({ ok: true });
				})
				.catch((err) => {
					console.error(`VM ${params.id} image import failed:`, err);
					params.onProvisionSettled?.({
						ok: false,
						error: err instanceof Error ? err.message : String(err)
					});
				});
		} else {
			const startUpid = await this.client.startVm(node.node, vmid);
			await this.client.waitForTask(node.node, startUpid);
			params.onProvisionSettled?.({ ok: true });
		}

		return { id: params.id, proxmoxId: vmid, taskId: String(vmid) };
	}

	async deleteVm(id: string, proxmoxId?: number): Promise<void> {
		let resolved: ResolvedVm;
		try {
			resolved = await this.resolve(id, proxmoxId);
		} catch (err) {
			if (err instanceof Error && err.message.includes('not found on any Proxmox node')) return;
			throw err;
		}

		const { node, vmid } = resolved;

		try {
			const status = await this.client.getQemuVm(node, vmid);
			if (status.status === 'running') {
				const stopUpid = await this.client.stopVm(node, vmid);
				await this.client.waitForTask(node, stopUpid);
			}
		} catch {
			// already stopped or gone
		}

		let upid: string;
		try {
			upid = await this.client.deleteQemuVm(node, vmid, {
				purge: true,
				destroyUnreferencedDisks: true
			});
		} catch (err) {
			if (err instanceof HTTPError && err.response.status === 404) return;
			throw err;
		}

		await this.client.waitForTask(node, upid);
	}

	async startVm(id: string, proxmoxId?: number): Promise<void> {
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async stopVm(id: string, proxmoxId?: number): Promise<void> {
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.shutdownVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async killVm(id: string, proxmoxId?: number): Promise<void> {
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.stopVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async rebootVm(id: string, proxmoxId?: number): Promise<void> {
		const { node, vmid } = await this.resolve(id, proxmoxId);
		const upid = await this.client.rebootVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}
}
