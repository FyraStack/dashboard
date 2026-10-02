export interface PveResponse<T> {
	data: T;
}

export interface PveNode {
	cpu: number;
	disk: number;
	maxcpu: number;
	maxdisk: number;
	maxmem: number;
	mem: number;
	node: string;
	status: 'online' | 'offline' | 'unknown';
	uptime: number;
}

export interface PveQemuVm {
	cpus?: number;
	diskread?: number;
	diskwrite?: number;
	maxdisk?: number;
	maxmem?: number;
	name?: string;
	netin?: number;
	netout?: number;
	pid?: number;
	status: 'running' | 'stopped' | 'paused';
	uptime?: number;
	vmid: number;
}

export interface PveQemuConfig {
	boot?: string;
	cicustom?: string;
	ciuser?: string;
	cores?: number;
	cpu?: string;
	ide2?: string;
	ipconfig0?: string;
	memory?: number;
	name?: string;
	net0?: string;
	ostype?: string;
	scsi0?: string;
	scsihw?: string;
	sockets?: number;
	sshkeys?: string;
	virtio0?: string;
	[key: string]: unknown;
}

export interface PveQemuStatus {
	cpu?: number;
	cpus?: number;
	disk?: number;
	diskread?: number;
	diskwrite?: number;
	ha?: { managed: number };
	maxdisk?: number;
	maxmem?: number;
	mem?: number;
	name?: string;
	netin?: number;
	netout?: number;
	pid?: number;
	qmpstatus?: string;
	status: 'running' | 'stopped' | 'paused';
	uptime?: number;
	vmid: number;
}

export interface PveQemuRrdData {
	cpu?: number;
	diskread?: number;
	diskwrite?: number;
	maxmem?: number;
	mem?: number;
	netin?: number;
	netout?: number;
	time: number;
}

export interface PveStorage {
	active?: 0 | 1;
	avail?: number;
	content: string;
	enabled?: 0 | 1;
	shared?: 0 | 1;
	storage: string;
	total?: number;
	type: string;
	used?: number;
}

export interface PveTask {
	endtime?: number;
	exitstatus?: string;
	node: string;
	starttime: number;
	status?: string;
	type: string;
	upid: string;
	user: string;
}

export interface PveTaskLogLine {
	n: number;
	t: string;
}

export interface PveTaskStatus {
	exitstatus?: string;
	pid: number;
	status: 'running' | 'stopped';
	type: string;
	upid: string;
}

export interface PveCreateQemuParams {
	agent?: string;
	bios?: 'seabios' | 'ovmf';
	boot?: string;
	cicustom?: string;
	ciupgrade?: 0 | 1;
	ciuser?: string;
	cores?: number;
	cpu?: string;
	efidisk0?: string;
	ide2?: string;
	ipconfig0?: string;
	machine?: string;
	memory?: number;
	name?: string;
	net0?: string;
	ostype?: string;
	scsi0?: string;
	scsihw?: string;
	serial0?: string;
	sockets?: number;
	sshkeys?: string;
	start?: 0 | 1;
	tpmstate0?: string;
	virtio0?: string;
	vmid: number;
	[key: string]: unknown;
}

export interface PveClusterResource {
	cpu?: number;
	disk?: number;
	hastate?: string;
	id: string;
	maxcpu?: number;
	maxdisk?: number;
	maxmem?: number;
	mem?: number;
	name?: string;
	node?: string;
	status?: string;
	tags?: string;
	type: 'qemu' | 'lxc' | 'storage' | 'node' | 'sdn';
	uptime?: number;
	vmid?: number;
}

export interface PveStorageContent {
	content: string;
	ctime?: number;
	format: string;
	size: number;
	volid: string;
}

export interface PveAgentNetworkInterface {
	'hardware-address'?: string;
	'ip-addresses'?: {
		'ip-address-type': 'ipv4' | 'ipv6';
		'ip-address': string;
		prefix: number;
	}[];
	name: string;
}
