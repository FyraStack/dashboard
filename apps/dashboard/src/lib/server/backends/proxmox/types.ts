export interface PveResponse<T> {
	data: T;
}

export interface PveNode {
	node: string;
	status: 'online' | 'offline' | 'unknown';
	maxcpu: number;
	cpu: number;
	maxmem: number;
	mem: number;
	maxdisk: number;
	disk: number;
	uptime: number;
}

export interface PveQemuVm {
	vmid: number;
	name?: string;
	status: 'running' | 'stopped' | 'paused';
	cpus?: number;
	maxmem?: number;
	maxdisk?: number;
	uptime?: number;
	diskread?: number;
	diskwrite?: number;
	netin?: number;
	netout?: number;
	pid?: number;
}

export interface PveQemuConfig {
	name?: string;
	memory?: number;
	cores?: number;
	sockets?: number;
	cpu?: string;
	ostype?: string;
	boot?: string;
	scsihw?: string;
	ide2?: string;
	scsi0?: string;
	net0?: string;
	cicustom?: string;
	ipconfig0?: string;
	ciuser?: string;
	sshkeys?: string;
	[key: string]: unknown;
}

export interface PveQemuStatus {
	status: 'running' | 'stopped' | 'paused';
	vmid: number;
	name?: string;
	cpus?: number;
	cpu?: number;
	maxmem?: number;
	mem?: number;
	maxdisk?: number;
	disk?: number;
	uptime?: number;
	diskread?: number;
	diskwrite?: number;
	netin?: number;
	netout?: number;
	pid?: number;
	qmpstatus?: string;
	ha?: { managed: number };
}

export interface PveQemuRrdData {
	time: number;
	cpu?: number;
	mem?: number;
	maxmem?: number;
	netin?: number;
	netout?: number;
	diskread?: number;
	diskwrite?: number;
}

export interface PveStorage {
	storage: string;
	type: string;
	content: string;
	total?: number;
	used?: number;
	avail?: number;
	active?: 0 | 1;
	enabled?: 0 | 1;
	shared?: 0 | 1;
}

export interface PveTask {
	upid: string;
	node: string;
	status?: string;
	exitstatus?: string;
	type: string;
	starttime: number;
	endtime?: number;
	user: string;
}

export interface PveTaskStatus {
	status: 'running' | 'stopped';
	exitstatus?: string;
	type: string;
	pid: number;
	upid: string;
}

export type PveNextId = number;

export interface PveCreateQemuParams {
	vmid: number;
	name?: string;
	memory?: number;
	cores?: number;
	sockets?: number;
	cpu?: string;
	ostype?: string;
	bios?: 'seabios' | 'ovmf';
	machine?: string;
	efidisk0?: string;
	virtio0?: string;
	scsihw?: string;
	scsi0?: string;
	ide2?: string;
	net0?: string;
	cicustom?: string;
	boot?: string;
	serial0?: string;
	agent?: string;
	ipconfig0?: string;
	ciuser?: string;
	sshkeys?: string;
	ciupgrade?: 0 | 1;
	start?: 0 | 1;
	[key: string]: unknown;
}

export interface PveClusterResource {
	id: string;
	type: 'qemu' | 'lxc' | 'storage' | 'node' | 'sdn';
	node?: string;
	vmid?: number;
	name?: string;
	status?: string;
	maxcpu?: number;
	maxmem?: number;
	maxdisk?: number;
	cpu?: number;
	mem?: number;
	disk?: number;
	uptime?: number;
}

export interface PveStorageContent {
	volid: string;
	content: string;
	format: string;
	size: number;
	ctime?: number;
}

export interface PveAgentNetworkInterface {
	name: string;
	'hardware-address'?: string;
	'ip-addresses'?: {
		'ip-address-type': 'ipv4' | 'ipv6';
		'ip-address': string;
		prefix: number;
	}[];
}
