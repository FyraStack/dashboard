import { ProxmoxClient } from './client';
import type { PveClusterResource } from './types';
import type { VmBackend, VmInfo, VmCreateParams, VmCreateResult, VmStatus } from '../types';

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

	private async resolve(id: string): Promise<ResolvedVm> {
		const resources = await this.client.getClusterResources('vm');
		const match = resources.find((r) => r.type === 'qemu' && r.name === id);

		if (!match || !match.node || match.vmid == null) {
			throw new Error(`VM "${id}" not found on any Proxmox node`);
		}

		return { node: match.node, vmid: match.vmid };
	}

	private resourceToInfo(r: PveClusterResource): VmInfo {
		return {
			id: r.name ?? String(r.vmid),
			name: r.name ?? `VM ${r.vmid}`,
			status: this.mapStatus(r.status ?? 'unknown'),
			cores: r.maxcpu ?? 0,
			memory: r.maxmem ?? 0,
			disk: r.maxdisk ?? 0,
			uptime: r.uptime ?? 0
		};
	}

	async listVms(): Promise<VmInfo[]> {
		const resources = await this.client.getClusterResources('vm');
		return resources.filter((r) => r.type === 'qemu').map((r) => this.resourceToInfo(r));
	}

	async getVm(id: string): Promise<VmInfo> {
		const { node, vmid } = await this.resolve(id);
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

		return {
			id,
			name: status.name ?? `VM ${status.vmid}`,
			status: this.mapStatus(status.status),
			cores: status.cpus ?? 0,
			memory: status.maxmem ?? 0,
			disk: status.maxdisk ?? 0,
			uptime: status.uptime ?? 0,
			networkInterfaces
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

		// Phase 1 — create the VM shell (no boot disk yet, returns instantly)
		await this.client.createQemuVm(node.node, {
			vmid,
			name: params.id,
			cores: params.cores,
			sockets: 1,
			memory: params.memoryMb,
			cpu: 'host',
			ostype: 'l26',
			bios: 'ovmf',
			machine: 'q35',
			efidisk0: 'local-lvm:0,efitype=4m,pre-enrolled-keys=1',
			// blank disk when no image; cloud images are imported in phase 2
			...(params.imageId ? {} : { virtio0: `local-lvm:${params.diskGb}` }),
			net0: 'virtio,bridge=vmbr0',
			boot: 'order=virtio0',
			ide2: 'local-lvm:cloudinit',
			serial0: 'socket',
			agent: '1',
			...(sshKeysEncoded ? { ciuser: 'root', sshkeys: sshKeysEncoded, ipconfig0: 'ip=dhcp' } : {})
		});

		// Phase 2 — import cloud image as boot disk (runs in background)
		if (params.imageId) {
			const importUpid = await this.client.updateQemuConfigAsync(node.node, vmid, {
				virtio0: `local-lvm:0,import-from=${params.imageId}`
			});

			// Don't block the request — finish import + resize in the background
			this.client
				.waitForTask(node.node, importUpid)
				.then(async () => {
					if (params.diskGb > 0) {
						await this.client.resizeDisk(node.node, vmid, 'virtio0', `${params.diskGb}G`);
					}
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
			// No image import needed — VM is ready immediately
			params.onProvisionSettled?.({ ok: true });
		}

		return { id: params.id, taskId: String(vmid) };
	}

	async deleteVm(id: string): Promise<void> {
		const { node, vmid } = await this.resolve(id);

		try {
			const status = await this.client.getQemuVm(node, vmid);
			if (status.status === 'running') {
				const stopUpid = await this.client.stopVm(node, vmid);
				await this.client.waitForTask(node, stopUpid);
			}
		} catch {
			// already stopped or gone
		}

		const upid = await this.client.deleteQemuVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async startVm(id: string): Promise<void> {
		const { node, vmid } = await this.resolve(id);
		const upid = await this.client.startVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async stopVm(id: string): Promise<void> {
		const { node, vmid } = await this.resolve(id);
		const upid = await this.client.shutdownVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async killVm(id: string): Promise<void> {
		const { node, vmid } = await this.resolve(id);
		const upid = await this.client.stopVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}

	async rebootVm(id: string): Promise<void> {
		const { node, vmid } = await this.resolve(id);
		const upid = await this.client.rebootVm(node, vmid);
		await this.client.waitForTask(node, upid);
	}
}
