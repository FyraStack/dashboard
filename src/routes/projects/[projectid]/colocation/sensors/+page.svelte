<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Dialog from '$lib/components/ui/dialog';
	import Icon from '$lib/components/icon.svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import {
		officialImages,
		imageTypeColors,
		type OfficialImage,
		type ImageType
	} from '$lib/data/images';
	import {
		Warehouse,
		Plus,
		Copy,
		Check,
		Power,
		Pencil,
		X,
		RotateCw,
		PowerOff,
		Thermometer,
		Cpu,
		HardDrive as HdIcon,
		Fan,
		BarChart3,
		Globe,
		Settings,
		Trash2,
		Activity,
		Disc,
		Search,
		Upload,
		ChevronLeft,
		ChevronRight,
		DollarSign
	} from '@lucide/svelte';

	type ColoUnit = {
		id: string;
		name: string;
		rackSize: string;
		location: string;
		powerDraw: string;
		powerBudget: string;
		ip: string;
		status: 'online' | 'offline' | 'provisioning';
		monthlyRate: string;
		created: string;
	};

	let units = $state<ColoUnit[]>([
		{
			id: 'colo-001',
			name: 'db-primary',
			rackSize: '1U',
			location: 'Rack A12, Slot 24',
			powerDraw: '180W',
			powerBudget: '350W',
			ip: '23.193.50.10',
			status: 'online',
			monthlyRate: '$50',
			created: '2026-02-10'
		},
		{
			id: 'colo-002',
			name: 'storage-node',
			rackSize: '2U',
			location: 'Rack A12, Slot 22-23',
			powerDraw: '340W',
			powerBudget: '500W',
			ip: '23.193.50.11',
			status: 'online',
			monthlyRate: '$85',
			created: '2026-03-01'
		},
		{
			id: 'colo-003',
			name: 'gpu-worker',
			rackSize: '4U',
			location: 'Rack B03, Slot 10-13',
			powerDraw: '0W',
			powerBudget: '700W',
			ip: '23.193.50.12',
			status: 'offline',
			monthlyRate: '$200',
			created: '2026-03-20'
		}
	]);

	let selectedUnitId = $state(page.url.searchParams.get('unit') ?? 'colo-001');

	$effect(() => {
		const fromUrl = page.url.searchParams.get('unit');
		if (fromUrl && units.some((u) => u.id === fromUrl)) {
			selectedUnitId = fromUrl;
		}
	});
	let selectedUnit = $derived(units.find((u) => u.id === selectedUnitId) ?? units[0]);
	let selectedUnitIdx = $derived(units.findIndex((u) => u.id === selectedUnitId));

	// Rack diagram helpers
	const totalRackSlots = 42;

	function parseSlots(location: string): { rack: string; start: number; end: number } {
		const rackMatch = location.match(/Rack\s+([A-Za-z0-9]+)/);
		const slotMatch = location.match(/Slot\s+(\d+)(?:-(\d+))?/);
		const rack = rackMatch?.[1] ?? '??';
		const start = slotMatch ? parseInt(slotMatch[1]) : 1;
		const end = slotMatch?.[2] ? parseInt(slotMatch[2]) : start;
		return { rack, start, end };
	}

	// All occupied slots in the same rack as the selected unit
	let rackInfo = $derived(() => {
		const sel = parseSlots(selectedUnit.location);
		const occupied: {
			start: number;
			end: number;
			name: string;
			isCurrent: boolean;
			status: string;
		}[] = [];
		for (const u of units) {
			const s = parseSlots(u.location);
			if (s.rack === sel.rack) {
				occupied.push({
					start: s.start,
					end: s.end,
					name: u.name,
					isCurrent: u.id === selectedUnitId,
					status: u.status
				});
			}
		}
		return { rack: sel.rack, occupied };
	});

	// Zoomed rack view
	const viewPad = 5;
	let rackView = $derived(() => {
		const sel = parseSlots(selectedUnit.location);
		const start = Math.max(1, sel.start - viewPad);
		const end = Math.min(totalRackSlots, sel.end + viewPad);
		return { start, end, slots: end - start + 1 };
	});

	// Tabs
	type Tab = 'overview' | 'networking' | 'images' | 'ipmi' | 'sensors' | 'settings';
	const activeTab = 'overview' as Tab;

	const tabs: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
		{ id: 'overview', label: 'Overview', icon: BarChart3 },
		{ id: 'networking', label: 'Networking', icon: Globe },
		{ id: 'images', label: 'Images', icon: Disc },
		{ id: 'ipmi', label: 'IPMI', icon: Power },
		{ id: 'sensors', label: 'Sensors', icon: Activity },
		{ id: 'settings', label: 'Settings', icon: Settings }
	];

	function tabHref(tab: Tab, unitId = selectedUnitId) {
		const base = '/projects/' + page.params.projectid + '/colocation';
		const path = tab === 'overview' ? base : `${base}/${tab}`;
		return `${path}?unit=${encodeURIComponent(unitId)}`;
	}

	// Charts
	type ChartDef = { label: string; color: string; points: string; value: string };
	const charts: ChartDef[] = [
		{
			label: 'Power Draw',
			color: '#fb923c',
			points: '0,50 20,48 40,45 60,42 80,50 100,55 120,52 140,48 160,45 180,50 200,48 240,46',
			value: '180W'
		},
		{
			label: 'CPU Temp',
			color: '#ef6b6b',
			points: '0,55 20,52 40,48 60,45 80,40 100,38 120,42 140,45 160,48 180,44 200,42 240,40',
			value: '52°C'
		},
		{
			label: 'Bandwidth In',
			color: '#4ade80',
			points: '0,65 20,60 40,55 60,50 80,45 100,48 120,52 140,50 160,48 180,45 200,42 240,40',
			value: '42 Mbps'
		},
		{
			label: 'Bandwidth Out',
			color: '#60a5fa',
			points: '0,70 20,68 40,65 60,62 80,60 100,58 120,55 140,58 160,60 180,62 200,60 240,58',
			value: '12 Mbps'
		}
	];

	let copied = $state('');
	function copyText(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => (copied = ''), 1500);
	}

	// Power bar
	let powerPct = $derived(() => {
		const draw = parseInt(selectedUnit.powerDraw);
		const budget = parseInt(selectedUnit.powerBudget);
		return budget > 0 ? (draw / budget) * 100 : 0;
	});

	// Add unit
	let addOpen = $state(false);
	let newName = $state('');
	let newRackSize = $state('1U');
	let unitCounter = $state(3);
	const rackSizes = ['1U', '2U', '4U', '6U'];
	const rackPrices: Record<string, string> = {
		'1U': '$50/mo',
		'2U': '$85/mo',
		'4U': '$200/mo',
		'6U': '$280/mo'
	};

	function addUnit() {
		if (!newName.trim()) return;
		unitCounter++;
		const newU: ColoUnit = {
			id: `colo-${String(unitCounter).padStart(3, '0')}`,
			name: newName.trim(),
			rackSize: newRackSize,
			location: `Rack B03, Slot ${unitCounter * 2}`,
			powerDraw: '0W',
			powerBudget: newRackSize === '1U' ? '350W' : newRackSize === '2U' ? '500W' : '700W',
			ip: `23.193.50.${12 + unitCounter}`,
			status: 'provisioning',
			monthlyRate: rackPrices[newRackSize].replace('/mo', ''),
			created: new Date().toISOString().slice(0, 10)
		};
		units.push(newU);
		selectedUnitId = newU.id;
		setTimeout(() => {
			const idx = units.findIndex((u) => u.id === newU.id);
			if (idx !== -1) units[idx].status = 'online';
		}, 3000);
		newName = '';
		newRackSize = '1U';
		addOpen = false;
	}

	// IPMI
	let ipmiPassword = $state('');
	let showIpmi = $state(false);
	let ipmiAction = $state('');

	function generateIpmiPassword() {
		ipmiPassword = Array.from(
			{ length: 16 },
			() =>
				'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'[
					Math.floor(Math.random() * 58)
				]
		).join('');
		showIpmi = true;
	}

	function ipmiCommand(action: string) {
		ipmiAction = action;
		const idx = units.findIndex((u) => u.id === selectedUnitId);
		if (idx === -1) return;
		if (action === 'power-on') {
			units[idx].status = 'online';
			units[idx].powerDraw = `${Math.floor(Math.random() * 150 + 100)}W`;
			setTimeout(() => (ipmiAction = ''), 1500);
		} else if (action === 'power-off') {
			units[idx].status = 'offline';
			units[idx].powerDraw = '0W';
			setTimeout(() => (ipmiAction = ''), 1500);
		} else if (action === 'reset') {
			units[idx].status = 'provisioning';
			setTimeout(() => {
				units[idx].status = 'online';
				ipmiAction = '';
			}, 3000);
		} else if (action === 'power-cycle') {
			units[idx].status = 'offline';
			units[idx].powerDraw = '0W';
			setTimeout(() => {
				units[idx].status = 'online';
				units[idx].powerDraw = `${Math.floor(Math.random() * 150 + 100)}W`;
				ipmiAction = '';
			}, 3000);
		} else {
			setTimeout(() => (ipmiAction = ''), 1500);
		}
	}

	// SNMP sensors
	const sensorData = $derived(() => {
		if (selectedUnit.status === 'offline') return null;
		return {
			cpuTemp: Math.floor(Math.random() * 15 + 45),
			inletTemp: Math.floor(Math.random() * 5 + 22),
			exhaustTemp: Math.floor(Math.random() * 8 + 32),
			disk1Temp: Math.floor(Math.random() * 10 + 30),
			disk2Temp: Math.floor(Math.random() * 10 + 30),
			fan1: Math.floor(Math.random() * 2000 + 5000),
			fan2: Math.floor(Math.random() * 2000 + 5000),
			fan3: Math.floor(Math.random() * 2000 + 5000),
			fan4: Math.floor(Math.random() * 2000 + 5000),
			vCore: (Math.random() * 0.1 + 1.1).toFixed(3),
			v33: (Math.random() * 0.05 + 3.3).toFixed(3),
			v5: (Math.random() * 0.1 + 4.95).toFixed(3),
			v12: (Math.random() * 0.2 + 11.9).toFixed(3)
		};
	});

	// IP management
	type ColoIp = { address: string; rdns: string; type: 'Primary' | 'Additional' };
	let coloIps = $state<Record<string, ColoIp[]>>({
		'colo-001': [
			{ address: '23.193.50.10', rdns: 'db-primary.stack.sh', type: 'Primary' },
			{ address: '23.193.50.110', rdns: '', type: 'Additional' }
		],
		'colo-002': [{ address: '23.193.50.11', rdns: 'storage.stack.sh', type: 'Primary' }],
		'colo-003': [{ address: '23.193.50.12', rdns: '', type: 'Primary' }]
	});
	let currentIps = $derived(coloIps[selectedUnitId] ?? []);
	let addIpOpen = $state(false);
	let newIpAddr = $state('');
	let newIpRdns = $state('');
	let editingColoRdns = $state<number | null>(null);
	let coloRdnsValue = $state('');

	function addColoIp() {
		if (!newIpAddr.trim()) return;
		if (!coloIps[selectedUnitId]) coloIps[selectedUnitId] = [];
		coloIps[selectedUnitId].push({
			address: newIpAddr.trim(),
			rdns: newIpRdns.trim(),
			type: 'Additional'
		});
		newIpAddr = '';
		newIpRdns = '';
		addIpOpen = false;
	}
	function saveColoRdns(idx: number) {
		const ips = coloIps[selectedUnitId];
		if (ips && ips[idx]) ips[idx].rdns = coloRdnsValue;
		editingColoRdns = null;
	}
	function deleteColoIp(idx: number) {
		const ips = coloIps[selectedUnitId];
		if (ips) coloIps[selectedUnitId] = ips.filter((_, i) => i !== idx);
	}

	// Images (IPMI virtual media)
	type UserImage = {
		id: string;
		name: string;
		type: ImageType;
		size: string;
		uploaded: string;
		status: 'ready' | 'uploading' | 'processing';
		progress: number;
	};
	let coloUserImages = $state<UserImage[]>([
		{
			id: 'img-008',
			name: 'custom-webserver',
			type: 'img',
			size: '8.4 GB',
			uploaded: '2026-03-28',
			status: 'ready',
			progress: 100
		}
	]);

	let coloImgSearch = $state('');
	let coloImgPage = $state(0);
	const coloImgPerPage = 6;
	let selectedColoImage = $state<OfficialImage | null>(null);
	let coloImgSheetOpen = $state(false);
	let mountedColoImage = $state<string | null>(null);
	let bootingFromImage = $state(false);
	let coloImgUploadOpen = $state(false);
	let coloImgUploadName = $state('');
	let coloImgUploadFile = $state('');
	let coloImgUploadDetectedType = $state<ImageType | null>(null);
	let coloImgUploadUrl = $state('');
	let coloImgUploadMethod = $state<'file' | 'url'>('file');
	let coloImgCounter = $state(10);

	function filteredColoOfficialImages() {
		if (!coloImgSearch.trim()) return officialImages;
		const q = coloImgSearch.toLowerCase();
		return officialImages.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.versions.some((v) => v.version.toLowerCase().includes(q))
		);
	}
	let coloImgTotalPages = $derived(Math.ceil(filteredColoOfficialImages().length / coloImgPerPage));
	let pagedColoOfficialImages = $derived(() => {
		const list = filteredColoOfficialImages();
		return list.slice(coloImgPage * coloImgPerPage, (coloImgPage + 1) * coloImgPerPage);
	});
	let filteredColoUserImages = $derived(() => {
		if (!coloImgSearch.trim()) return coloUserImages;
		const q = coloImgSearch.toLowerCase();
		return coloUserImages.filter((i) => i.name.toLowerCase().includes(q));
	});

	function openColoImageDetail(img: OfficialImage) {
		selectedColoImage = img;
		coloImgSheetOpen = true;
	}
	function closeColoImageDetail() {
		coloImgSheetOpen = false;
		setTimeout(() => (selectedColoImage = null), 200);
	}
	function mountColoOfficialVersion(name: string, version: string) {
		mountedColoImage = `${name} ${version}`;
	}
	function mountColoUserImage(name: string) {
		mountedColoImage = name;
	}
	function unmountColoImage() {
		mountedColoImage = null;
	}

	function bootFromMountedImage() {
		if (!mountedColoImage) return;
		bootingFromImage = true;
		const idx = units.findIndex((u) => u.id === selectedUnitId);
		if (idx !== -1) units[idx].status = 'provisioning';
		setTimeout(() => {
			if (idx !== -1) units[idx].status = 'online';
			bootingFromImage = false;
		}, 3000);
	}

	function detectColoImgType(filename: string): ImageType | null {
		const ext = filename.split('.').pop()?.toLowerCase();
		if (ext === 'iso') return 'iso';
		if (ext === 'img') return 'img';
		if (ext === 'qcow2') return 'qcow2';
		return null;
	}
	function handleColoImgFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		coloImgUploadFile = f.name;
		coloImgUploadDetectedType = detectColoImgType(f.name);
		if (!coloImgUploadName) coloImgUploadName = f.name.replace(/\.[^.]+$/, '');
	}
	function handleColoImgUrlChange() {
		if (coloImgUploadUrl)
			coloImgUploadDetectedType = detectColoImgType(coloImgUploadUrl.split('/').pop() ?? '');
	}
	function startColoImgUpload() {
		if (!coloImgUploadName.trim()) return;
		const type = coloImgUploadDetectedType ?? 'img';
		coloImgCounter++;
		const sizes = ['1.2 GB', '2.8 GB', '4.5 GB', '680 MB', '9.1 GB'];
		const newImg: UserImage = {
			id: `img-${String(coloImgCounter).padStart(3, '0')}`,
			name: coloImgUploadName.trim(),
			type,
			size: sizes[Math.floor(Math.random() * sizes.length)],
			uploaded: new Date().toISOString().slice(0, 10),
			status: 'uploading',
			progress: 0
		};
		coloUserImages.push(newImg);
		coloImgUploadOpen = false;
		coloImgUploadName = '';
		coloImgUploadFile = '';
		coloImgUploadUrl = '';
		coloImgUploadDetectedType = null;
		const idx = coloUserImages.length - 1;
		const tick = setInterval(() => {
			if (coloUserImages[idx].progress >= 100) {
				coloUserImages[idx].status = 'processing';
				clearInterval(tick);
				setTimeout(() => {
					coloUserImages[idx].status = 'ready';
					coloUserImages[idx].progress = 100;
				}, 1500);
				return;
			}
			coloUserImages[idx].progress += Math.floor(Math.random() * 15 + 5);
			if (coloUserImages[idx].progress > 100) coloUserImages[idx].progress = 100;
		}, 400);
	}
	function deleteColoImage(id: string) {
		coloUserImages = coloUserImages.filter((i) => i.id !== id);
	}

	// Settings
	let editingName = $state(false);
	let nameValue = $state('');
	let deleteOpen = $state(false);
	let deleteConfirm = $state('');

	function saveName() {
		if (selectedUnitIdx !== -1) units[selectedUnitIdx].name = nameValue;
		editingName = false;
	}
	function doDelete() {
		if (deleteConfirm !== selectedUnit.id) return;
		units = units.filter((u) => u.id !== selectedUnit.id);
		if (units.length > 0) selectedUnitId = units[0].id;
		deleteOpen = false;
		deleteConfirm = '';
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Unit list -->
	<div class="flex w-64 shrink-0 flex-col border-r border-gray-800">
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-4">
			<div class="flex items-center gap-2">
				<Warehouse class="h-4 w-4 text-gray-400" />
				<span class="text-sm font-semibold text-gray-100">Colocation</span>
				<Badge variant="secondary" class="text-[10px]">{units.length}</Badge>
			</div>
			<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={() => (addOpen = true)}>
				<Plus class="h-3.5 w-3.5" />
			</Button>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#each units as unit (unit.id)}
				<a
					class="flex w-full items-center justify-between border-b border-gray-800 px-4 py-3 text-left transition-colors duration-100 {selectedUnitId ===
					unit.id
						? 'bg-gray-800/60'
						: 'hover:bg-gray-800/30'}"
					href={tabHref('overview', unit.id)}
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-gray-100">{unit.name}</p>
						<p class="mt-0.5 text-xs text-gray-500">{unit.rackSize} &bull; {unit.location}</p>
					</div>
					<span
						class="ml-2 h-2 w-2 shrink-0 rounded-full {unit.status === 'online'
							? 'bg-emerald-500'
							: unit.status === 'provisioning'
								? 'animate-pulse bg-amber-500'
								: 'bg-red-500'}"
					></span>
				</a>
			{/each}
			{#if units.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-gray-500">
					<Warehouse class="mb-3 h-6 w-6" />
					<p class="text-xs">No colocation units</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Detail panel -->
	{#if selectedUnit}
		<div class="flex flex-1 flex-col overflow-hidden">
			<!-- Header -->
			<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-5">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-gray-200">{selectedUnit.name}</span>
					<Badge
						variant="outline"
						class="text-[10px] {selectedUnit.status === 'online'
							? 'border-emerald-800 bg-emerald-950/40 text-emerald-400'
							: selectedUnit.status === 'provisioning'
								? 'border-amber-800 bg-amber-950/40 text-amber-400'
								: 'border-red-800 bg-red-950/40 text-red-400'}"
					>
						{selectedUnit.status}
					</Badge>
				</div>
				<span class="text-xs font-medium text-gray-400">{selectedUnit.monthlyRate}/mo</span>
			</div>

			<!-- Tab nav -->
			<div class="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-gray-800 px-2">
				{#each tabs as tab (tab.id)}
					<a
						class="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors duration-100 {activeTab ===
						tab.id
							? 'border-b-2 border-red-500 text-gray-50'
							: 'text-gray-500 hover:text-gray-300'}"
						href={tabHref(tab.id)}
					>
						<tab.icon class="h-3 w-3" />
						{tab.label}
					</a>
				{/each}
			</div>

			<!-- Tab content -->
			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="flex-1 overflow-auto">
					{#if sensorData()}
						{@const s = sensorData()!}
						<div class="divide-y divide-gray-800/50">
							<div class="px-5 py-3">
								<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
									>Temperatures</span
								>
							</div>
							{#each [['CPU Package', `${s.cpuTemp}°C`, s.cpuTemp > 70 ? 'text-red-400' : s.cpuTemp > 55 ? 'text-amber-400' : 'text-gray-200', 85], ['Inlet Ambient', `${s.inletTemp}°C`, 'text-gray-200', 40], ['Exhaust', `${s.exhaustTemp}°C`, s.exhaustTemp > 45 ? 'text-amber-400' : 'text-gray-200', 55], ['Disk 0 (sda)', `${s.disk1Temp}°C`, s.disk1Temp > 45 ? 'text-amber-400' : 'text-gray-200', 60], ['Disk 1 (sdb)', `${s.disk2Temp}°C`, s.disk2Temp > 45 ? 'text-amber-400' : 'text-gray-200', 60]] as [name, val, color, max]}
								<div class="flex items-center gap-4 px-5 py-2">
									<Thermometer class="h-3 w-3 shrink-0 text-gray-600" />
									<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
									<div class="h-1 flex-1 bg-gray-800">
										<div
											class="h-full bg-gray-600 transition-all"
											style="width: {(parseInt(String(val)) / Number(max)) * 100}%"
										></div>
									</div>
									<span class="w-12 shrink-0 text-right text-xs font-medium {color}">{val}</span>
								</div>
							{/each}

							<div class="px-5 py-3">
								<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
									>Fan Speeds</span
								>
							</div>
							{#each [['Fan 1', s.fan1], ['Fan 2', s.fan2], ['Fan 3', s.fan3], ['Fan 4', s.fan4]] as [name, rpm]}
								<div class="flex items-center gap-4 px-5 py-2">
									<Fan class="h-3 w-3 shrink-0 text-gray-600" />
									<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
									<div class="h-1 flex-1 bg-gray-800">
										<div
											class="h-full bg-gray-600 transition-all"
											style="width: {(Number(rpm) / 10000) * 100}%"
										></div>
									</div>
									<span class="w-16 shrink-0 text-right text-xs font-medium text-gray-200"
										>{rpm} RPM</span
									>
								</div>
							{/each}

							<div class="px-5 py-3">
								<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
									>Voltages</span
								>
							</div>
							{#each [['Vcore', `${s.vCore}V`, 0.9, 1.4], ['+3.3V', `${s.v33}V`, 3.1, 3.5], ['+5V', `${s.v5}V`, 4.7, 5.3], ['+12V', `${s.v12}V`, 11.5, 12.5]] as [name, val, lo, hi]}
								<div class="flex items-center gap-4 px-5 py-2">
									<Cpu class="h-3 w-3 shrink-0 text-gray-600" />
									<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
									<span class="text-xs text-gray-600">{lo}V</span>
									<div class="h-1 flex-1 bg-gray-800">
										<div
											class="h-full bg-emerald-600 transition-all"
											style="width: {((parseFloat(String(val)) - Number(lo)) /
												(Number(hi) - Number(lo))) *
												100}%"
										></div>
									</div>
									<span class="text-xs text-gray-600">{hi}V</span>
									<span class="w-16 shrink-0 text-right font-mono text-xs font-medium text-gray-200"
										>{val}</span
									>
								</div>
							{/each}

							<div class="px-5 py-3">
								<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
									>Power</span
								>
							</div>
							<div class="flex items-center justify-between px-5 py-2.5">
								<span class="text-xs text-gray-400">Current Draw</span>
								<span class="text-xs font-medium text-gray-200">{selectedUnit.powerDraw}</span>
							</div>
							<div class="flex items-center justify-between px-5 py-2.5">
								<span class="text-xs text-gray-400">Budget</span>
								<span class="text-xs font-medium text-gray-200">{selectedUnit.powerBudget}</span>
							</div>
							<div class="px-5 py-3">
								<div class="h-1.5 w-full bg-gray-800">
									<div
										class="h-full transition-all duration-500 {powerPct() > 80
											? 'bg-red-500'
											: powerPct() > 50
												? 'bg-amber-500'
												: 'bg-emerald-500'}"
										style="width: {powerPct()}%"
									></div>
								</div>
							</div>
						</div>
					{:else}
						<div class="flex flex-col items-center justify-center py-20 text-gray-500">
							<Activity class="mb-3 h-8 w-8" />
							<p class="text-sm">Server is powered off</p>
							<p class="mt-1 text-xs text-gray-600">Power on via IPMI to view sensor data.</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<!-- Add IP Dialog -->
<Dialog.Root bind:open={addIpOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add IP Address</Dialog.Title>
			<Dialog.Description>Request an additional IP for {selectedUnit.name}.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>IP Address</Label>
				<Input bind:value={newIpAddr} placeholder="23.193.50.x" class="font-mono" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Reverse DNS (optional)</Label>
				<Input bind:value={newIpRdns} placeholder="hostname.example.com" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (addIpOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={addColoIp} disabled={!newIpAddr.trim()}>Add</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Add Unit Dialog -->
<Dialog.Root bind:open={addOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add Colocation Unit</Dialog.Title>
			<Dialog.Description>Request a new colocation slot in Chicago, IL.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Equipment Name</Label>
				<Input bind:value={newName} placeholder="my-server" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Rack Size</Label>
				<div class="grid grid-cols-4 gap-2">
					{#each rackSizes as size (size)}
						<button
							class="border px-3 py-2 text-center text-sm transition-colors {newRackSize === size
								? 'border-red-500 bg-red-950/20 text-gray-100'
								: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
							onclick={() => (newRackSize = size)}
						>
							{size}
							<span class="mt-0.5 block text-[10px] text-gray-500">{rackPrices[size]}</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (addOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={addUnit} disabled={!newName.trim()}>Request Slot</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete Unit Dialog -->
<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Remove Colocation Unit</Dialog.Title>
			<Dialog.Description
				>This will release the rack space for <strong>{selectedUnit.name}</strong>. Type the unit ID
				to confirm.</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Label>Type unit ID to confirm</Label>
			<Input bind:value={deleteConfirm} placeholder={selectedUnit.id} class="font-mono" />
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (deleteOpen = false)}>Cancel</Button>
			<Button
				variant="outline"
				size="sm"
				class="border-red-700 text-red-400 hover:bg-red-950"
				disabled={deleteConfirm !== selectedUnit.id}
				onclick={doDelete}
			>
				Remove Unit
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Colo Image Detail Sheet -->
<Sheet.Root
	bind:open={coloImgSheetOpen}
	onOpenChange={(v) => {
		if (!v) closeColoImageDetail();
	}}
>
	<Sheet.Content side="right" class="border-gray-800 bg-gray-900 px-6 py-5 sm:max-w-md">
		{#if selectedColoImage}
			<Sheet.Header class="border-b border-gray-800 pb-4">
				<div class="flex items-start gap-4">
					<div class="shrink-0">
						{#if selectedColoImage.icon}
							<Icon name={selectedColoImage.icon} class="h-14 w-14 text-gray-300" />
						{:else}
							<span
								class="flex h-14 w-14 items-center justify-center text-2xl font-bold text-gray-300"
								>{selectedColoImage.shortName}</span
							>
						{/if}
					</div>
					<div class="flex-1">
						<div class="flex items-center gap-2">
							<Sheet.Title class="text-base">{selectedColoImage.name}</Sheet.Title>
							{#if selectedColoImage.paid}
								<Badge
									variant="outline"
									class="border-red-700 bg-red-950/40 text-[9px] text-red-400"
								>
									<DollarSign class="mr-0.5 h-2 w-2" />
									{selectedColoImage.price}
								</Badge>
							{/if}
						</div>
						<Sheet.Description class="mt-1 text-xs leading-relaxed"
							>{selectedColoImage.description}</Sheet.Description
						>
					</div>
				</div>
			</Sheet.Header>

			<div class="flex-1 overflow-auto py-4">
				<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
					>Available Versions</span
				>
				<div class="mt-3 divide-y divide-gray-800/30">
					{#each selectedColoImage.versions as ver (ver.version)}
						<div class="flex items-center justify-between py-3">
							<div class="flex items-center gap-3">
								<span class="text-sm font-medium text-gray-100">{ver.version}</span>
								<div class="flex gap-1">
									{#each ver.archs as arch (arch)}
										<span
											class="border border-gray-700 px-1.5 py-0.5 font-mono text-[9px] text-gray-400"
											>{arch}</span
										>
									{/each}
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Badge variant="outline" class="text-[8px] {imageTypeColors[ver.type]}"
									>{ver.type.toUpperCase()}</Badge
								>
								<span class="text-[10px] text-gray-500">{ver.size}</span>
							</div>
						</div>
						<div class="flex items-center gap-2 pb-3">
							<Button
								variant="ghost"
								size="sm"
								class="h-7 gap-1.5 px-3 text-xs"
								onclick={() => {
									mountColoOfficialVersion(selectedColoImage!.name, ver.version);
								}}
							>
								<Disc class="h-3 w-3" /> Mount via IPMI
							</Button>
							<Button
								variant="outline"
								size="sm"
								class="h-7 gap-1.5 px-3 text-xs"
								onclick={() => {
									mountColoOfficialVersion(selectedColoImage!.name, ver.version);
									coloImgSheetOpen = false;
									bootFromMountedImage();
								}}
							>
								<Power class="h-3 w-3" /> Mount & Boot
							</Button>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<!-- Upload Image Dialog (Colo) -->
<Dialog.Root bind:open={coloImgUploadOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Upload Image</Dialog.Title>
			<Dialog.Description
				>Upload a .iso or .img file to mount via IPMI virtual media.</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Image Name</Label>
				<Input bind:value={coloImgUploadName} placeholder="my-custom-image" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Source</Label>
				<div class="flex gap-2">
					<button
						class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {coloImgUploadMethod ===
						'file'
							? 'border-red-500 bg-red-950/20 text-gray-100'
							: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
						onclick={() => (coloImgUploadMethod = 'file')}>File Upload</button
					>
					<button
						class="flex-1 border px-3 py-2 text-center text-xs font-medium transition-colors {coloImgUploadMethod ===
						'url'
							? 'border-red-500 bg-red-950/20 text-gray-100'
							: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
						onclick={() => (coloImgUploadMethod = 'url')}>URL Import</button
					>
				</div>
			</div>
			{#if coloImgUploadMethod === 'file'}
				<label
					class="flex cursor-pointer flex-col items-center justify-center border border-dashed border-gray-600 bg-gray-800/30 px-4 py-6 text-center transition-colors hover:border-gray-500 hover:bg-gray-800/50"
				>
					<Upload class="mb-2 h-6 w-6 text-gray-500" />
					{#if coloImgUploadFile}
						<span class="text-xs font-medium text-gray-200">{coloImgUploadFile}</span>
						{#if coloImgUploadDetectedType}<span class="mt-1 text-[10px] text-gray-500"
								>Detected: .{coloImgUploadDetectedType}</span
							>{/if}
					{:else}
						<span class="text-xs text-gray-400">Drop or click to browse (.iso, .img, .qcow2)</span>
					{/if}
					<input
						type="file"
						accept=".iso,.img,.qcow2"
						class="hidden"
						onchange={handleColoImgFileSelect}
					/>
				</label>
			{:else}
				<div class="flex flex-col gap-2">
					<Label>Image URL</Label>
					<Input
						bind:value={coloImgUploadUrl}
						placeholder="https://example.com/image.iso"
						oninput={handleColoImgUrlChange}
					/>
					{#if coloImgUploadDetectedType}
						<p class="text-xs text-gray-500">Detected: .{coloImgUploadDetectedType}</p>
					{:else if coloImgUploadUrl}
						<p class="text-xs text-amber-500">Could not detect format. Will default to .img</p>
					{/if}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (coloImgUploadOpen = false)}>Cancel</Button
			>
			<Button
				size="sm"
				onclick={startColoImgUpload}
				disabled={!coloImgUploadName.trim() && !coloImgUploadFile && !coloImgUploadUrl}
			>
				<Upload class="h-3 w-3" /> Upload
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
