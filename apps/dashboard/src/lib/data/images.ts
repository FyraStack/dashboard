export type ImageType = 'iso' | 'img' | 'qcow2';

export type ImageVersion = {
	version: string;
	archs: string[];
	size: string;
	type: ImageType;
};

export type OfficialImage = {
	id: string;
	name: string;
	description: string;
	color: string;
	iconColor: string;
	icon?: string;
	paid: boolean;
	price?: string;
	versions: ImageVersion[];
};

export const officialImages: OfficialImage[] = [
	{
		id: 'fedora',
		name: 'Fedora Server',
		color: 'bg-sky-600',
		iconColor: '#51A2DA',
		icon: 'fedora',
		description:
			'Cutting-edge packages with SELinux, Cockpit web console, and modular repositories.',
		paid: false,
		versions: [
			{ version: '42', archs: ['x86_64', 'aarch64'], size: '2.4 GB', type: 'iso' },
			{ version: '41', archs: ['x86_64', 'aarch64'], size: '2.3 GB', type: 'iso' },
			{ version: '40', archs: ['x86_64', 'aarch64'], size: '2.2 GB', type: 'iso' }
		]
	},
	{
		id: 'debian',
		name: 'Debian',
		color: 'bg-red-700',
		iconColor: '#A81D33',
		icon: 'debian',
		description:
			'Rock-solid stability. Minimal footprint, long-term security updates, vast package archive.',
		paid: false,
		versions: [
			{ version: '12 (Bookworm)', archs: ['amd64', 'arm64'], size: '628 MB', type: 'iso' },
			{ version: '11 (Bullseye)', archs: ['amd64', 'arm64'], size: '694 MB', type: 'iso' }
		]
	},
	{
		id: 'ubuntu',
		name: 'Ubuntu Server',
		color: 'bg-orange-600',
		iconColor: '#E95420',
		icon: 'ubuntu',
		description: 'Industry-standard LTS. Snap packages, Livepatch kernel updates, 10-year support.',
		paid: false,
		versions: [
			{ version: '24.04 LTS', archs: ['amd64', 'arm64'], size: '1.8 GB', type: 'iso' },
			{ version: '22.04 LTS', archs: ['amd64', 'arm64'], size: '1.6 GB', type: 'iso' },
			{ version: '24.10', archs: ['amd64', 'arm64'], size: '1.9 GB', type: 'iso' }
		]
	},
	{
		id: 'centos',
		name: 'CentOS Stream',
		color: 'bg-yellow-600',
		iconColor: '#262577',
		icon: 'centos',
		description:
			'Continuously delivered distro tracking just ahead of RHEL. Rolling preview of the next RHEL minor release.',
		paid: false,
		versions: [
			{ version: '10', archs: ['x86_64', 'aarch64'], size: '1.9 GB', type: 'iso' },
			{ version: '9', archs: ['x86_64', 'aarch64'], size: '1.8 GB', type: 'iso' }
		]
	},
	{
		id: 'alma',
		name: 'AlmaLinux',
		color: 'bg-indigo-600',
		iconColor: '#0F4266',
		icon: 'almalinux',
		description:
			'Community-driven RHEL fork. Binary-compatible, free, and backed by the AlmaLinux OS Foundation.',
		paid: false,
		versions: [
			{ version: '9.4', archs: ['x86_64', 'aarch64'], size: '1.9 GB', type: 'iso' },
			{ version: '8.10', archs: ['x86_64', 'aarch64'], size: '1.8 GB', type: 'iso' }
		]
	},
	{
		id: 'alpine',
		name: 'Alpine Linux',
		color: 'bg-cyan-700',
		iconColor: '#0D597F',
		icon: 'alpine',
		description: 'Ultralight musl-based distribution. Perfect for containers and minimal installs.',
		paid: false,
		versions: [
			{ version: '3.20', archs: ['x86_64', 'aarch64'], size: '210 MB', type: 'iso' },
			{ version: '3.19', archs: ['x86_64', 'aarch64'], size: '195 MB', type: 'iso' }
		]
	}
];

export const imageTypeColors: Record<string, string> = {
	iso: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400',
	img: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
	qcow2:
		'border-purple-300 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-400'
};
