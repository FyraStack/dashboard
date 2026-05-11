<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import BillingSetupDialog from '$lib/components/billing-setup-dialog.svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { FeatureFlags } from '$lib/feature-flags';
	import { userSettingsHref } from '$lib/state/user-settings.svelte';
	import { createVolume as createProjectVolume } from '$lib/remote/volumes.remote';
	import { createVm } from '$lib/remote/vms.remote';
	import { getErrorMessage } from '$lib/utils';
	import { onMount } from 'svelte';
	import {
		ArrowLeft,
		HardDrive,
		Server,
		Globe,
		Key,
		Loader2,
		Check,
		Copy,
		Circle,
		Eye,
		EyeOff,
		HardDriveUpload,
		Plus,
		X
	} from '@lucide/svelte';

	type PageData = {
		currentProject?: { id: string } | null;
		sshKeys?: {
			id: string;
			name: string;
			fingerprint: string;
		}[];
		vmTypes?: VmType[];
		dbImages?: DbImage[];
		volumes?: ExistingVolume[];
		featureFlags?: FeatureFlags;
		billing?: { status?: string; setupRequired?: boolean } | null;
		canManageBilling?: boolean;
	};

	type ImageTab = 'os' | 'snapshots' | 'apps';
	let { data }: { data: PageData } = $props();
	let imageTab = $state<ImageTab>('os');

	type VmType = {
		id: string;
		name: string;
		cores: number;
		ramCapacity: number;
		storageAmount: number;
		rate: string;
		cap: string;
	};

	type DbImage = {
		id: string;
		name: string;
		version: string;
		color: string;
		icon: string | null;
		filePath: string;
		description: string;
		isOfficial: boolean;
		logoSvg: string | null;
		accentColor: string;
		imageType: string;
	};

	type ExistingVolume = {
		id: string;
		name: string;
		size: number;
		associatedVmId: string | null;
	};

	const vmTypes = $derived(data.vmTypes ?? []);
	const dbImages = $derived(data.dbImages ?? []);
	const officialDbImages = $derived(dbImages.filter((image) => image.isOfficial));
	const customDbImages = $derived(dbImages.filter((image) => !image.isOfficial));
	const volumesEnabled = $derived(!!data.featureFlags?.volumes);
	const projectId = $derived(data.currentProject?.id ?? page.params.projectid ?? '');
	const billingReady = $derived(data.billing?.status === 'active');
	const canManageBilling = $derived(Boolean(data.canManageBilling));

	let serverName = $state('');
	let selectedImageId = $state<string | null>(null);
	let selectedImageVersion = $state<string | null>(null);
	let selectedPlanId = $state<string | null>(null);
	let networkingOption = $state<'both' | 'ipv4' | 'ipv6' | 'none'>('both');
	let selectedSshKeyIds = $state<string[]>([]);
	let serverPassword = $state('');
	let showServerPassword = $state(false);
	let passwordCopied = $state(false);
	let selectedVolumeIds = $state<string[]>([]);

	type SelectableVolume = { id: string; name: string; sizeGb: number };
	let createdVolumes = $state<SelectableVolume[]>([]);
	let newVolumeName = $state('');
	let newVolumeSize = $state('10');
	let showCreateVolume = $state(false);

	let creating = $state(false);
	let creatingVolume = $state(false);
	let createError = $state('');
	let billingSetupOpen = $state(false);

	let selectedImage = $derived(dbImages.find((i) => i.id === selectedImageId) ?? null);
	let selectedPlan = $derived(vmTypes.find((t) => t.id === selectedPlanId) ?? null);
	let usePasswordAuthentication = $derived(selectedSshKeyIds.length === 0);
	let availableVolumes = $derived(
		volumesEnabled
			? [
					...(data.volumes ?? [])
						.filter((volume) => volume.associatedVmId === null)
						.map((volume) => ({
							id: volume.id,
							name: volume.name,
							sizeGb: volume.size
						})),
					...createdVolumes
				]
			: []
	);
	let selectedVolumeCount = $derived(
		volumesEnabled
			? selectedVolumeIds.filter((id) => availableVolumes.some((volume) => volume.id === id)).length
			: 0
	);

	type Section = {
		id: string;
		label: string;
		icon: typeof Server;
		isComplete: boolean;
	};

	let sections = $derived<Section[]>([
		{ id: 'name', label: 'Name', icon: Server, isComplete: serverName.trim().length > 0 },
		{
			id: 'image',
			label: 'Image',
			icon: HardDrive,
			isComplete: selectedImageId !== null && selectedImageVersion !== null
		},
		{ id: 'plan', label: 'Plan', icon: Server, isComplete: selectedPlanId !== null },
		...(volumesEnabled
			? [
					{
						id: 'storage',
						label: 'Storage',
						icon: HardDriveUpload,
						isComplete: selectedPlanId !== null
					}
				]
			: []),
		{ id: 'networking', label: 'Networking', icon: Globe, isComplete: true },
		{ id: 'ssh', label: 'Authentication', icon: Key, isComplete: true }
	]);

	let imagesSearch = $state('');
	const imageTabs: { id: ImageTab; label: string }[] = [
		{ id: 'os', label: 'OS Images' },
		{ id: 'snapshots', label: 'Snapshots' },
		{ id: 'apps', label: 'Apps' }
	];
	function setImageTab(value: string) {
		if (value === 'os' || value === 'snapshots' || value === 'apps') {
			imageTab = value;
		}
	}

	onMount(() => {
		serverPassword = generatePassword();
		if (!billingReady) billingSetupOpen = true;
	});

	function randomIndex(max: number): number {
		if (globalThis.crypto?.getRandomValues) {
			const value = new Uint32Array(1);
			globalThis.crypto.getRandomValues(value);
			return value[0] % max;
		}

		return Math.floor(Math.random() * max);
	}

	function generatePassword(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+';
		return Array.from({ length: 24 }, () => chars[randomIndex(chars.length)]).join('');
	}

	function filteredOfficialImages(): DbImage[] {
		if (!imagesSearch.trim()) return officialDbImages;
		const q = imagesSearch.toLowerCase();
		return officialDbImages.filter(
			(i) => i.name.toLowerCase().includes(q) || i.version.toLowerCase().includes(q)
		);
	}

	function selectImage(imageId: string) {
		if (selectedImageId === imageId) {
			selectedImageId = null;
			selectedImageVersion = null;
		} else {
			selectedImageId = imageId;
			const img = dbImages.find((i) => i.id === imageId);
			selectedImageVersion = img?.version ?? null;
		}
	}

	function scrollTosSection(sectionId: string) {
		const el = document.getElementById(`section-${sectionId}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	function formatBytes(bytes: number): string {
		if (!bytes) return '0B';
		const gb = bytes / (1024 * 1024 * 1024);
		if (gb >= 1) return `${gb.toFixed(0)}GB`;
		const mb = bytes / (1024 * 1024);
		return `${mb.toFixed(0)}MB`;
	}

	function formatRam(mb: number): string {
		if (mb >= 1024) return `${(mb / 1024).toFixed(0)}GB`;
		return `${mb}MB`;
	}

	async function createVolume() {
		if (!volumesEnabled || creatingVolume) return;

		const name = newVolumeName.trim();
		const size = parseInt(newVolumeSize, 10);
		const projectId = page.params.projectid;
		if (!name || !size || size < 1 || !projectId) return;
		creatingVolume = true;
		try {
			const created = await createProjectVolume({ projectId, name, size });
			createdVolumes = [...createdVolumes, { id: created.id, name, sizeGb: size }];
			selectedVolumeIds = [...selectedVolumeIds, created.id];
			newVolumeName = '';
			newVolumeSize = '10';
			showCreateVolume = false;
		} catch (err) {
			createError = getErrorMessage(err, 'Failed to create volume. Please try again.');
		} finally {
			creatingVolume = false;
		}
	}

	function truncateFingerprint(fp: string): string {
		if (fp.length <= 24) return fp;
		return `${fp.slice(0, 12)}...${fp.slice(-8)}`;
	}

	async function copyServerPassword() {
		if (!serverPassword) return;
		await navigator.clipboard.writeText(serverPassword);
		passwordCopied = true;
		window.setTimeout(() => {
			passwordCopied = false;
		}, 1500);
	}

	async function handleCreate() {
		if (
			!serverName.trim() ||
			!selectedPlanId ||
			(usePasswordAuthentication && !serverPassword.trim())
		) {
			return;
		}

		if (!projectId) {
			createError = 'No project selected. Please select a project.';
			return;
		}
		if (!billingReady) {
			billingSetupOpen = true;
			return;
		}

		creating = true;
		createError = '';

		const imageId = selectedImageId ?? undefined;

		try {
			const payload = {
				projectId,
				vmTypeId: selectedPlanId,
				name: serverName.trim(),
				...(imageId ? { imageId } : {}),
				...(selectedSshKeyIds.length > 0 ? { sshKeyIds: selectedSshKeyIds } : {}),
				...(usePasswordAuthentication ? { password: serverPassword.trim() } : {})
			};
			const created = await createVm(payload);
			await invalidate('project:vms');
			goto(resolve(`/projects/${projectId}/servers/${created.id}`));
		} catch (err) {
			createError = getErrorMessage(err, 'Failed to create server. Please try again.');
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Create Server / Stack</title>
</svelte:head>

<div class="flex h-full flex-col overflow-hidden">
	<BillingSetupDialog
		bind:open={billingSetupOpen}
		{projectId}
		{billingReady}
		{canManageBilling}
		mode="server-create"
		returnTo={`/projects/${projectId}/servers/create`}
	/>

	<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-5">
		<div class="flex items-center gap-3">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 gap-1.5 px-2 text-xs text-gray-400 hover:text-gray-200"
				onclick={() => goto(resolve(`/projects/${page.params.projectid}/servers`))}
			>
				<ArrowLeft class="h-3 w-3" />
				Back
			</Button>
			<span class="text-sm font-semibold text-gray-100">Create Server</span>
		</div>
	</div>

	<div class="flex flex-1 overflow-hidden">
		<div class="flex-1 overflow-y-auto">
			<div class="px-6 py-6">
				<div class="flex flex-col gap-8">
					<div id="section-name" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
							<Server class="h-3.5 w-3.5 text-red-400" />
							<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Name</span>
						</div>
						<div class="mt-3">
							<Input bind:value={serverName} placeholder="my-server" class="h-9 text-sm" />
						</div>
					</div>

					<div id="section-image" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
							<HardDrive class="h-3.5 w-3.5 text-red-400" />
							<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Image</span
							>
						</div>
						<Tabs.Root bind:value={() => imageTab, setImageTab} class="mt-3">
							<Tabs.List class="h-auto gap-2 rounded-none bg-transparent p-0">
								{#each imageTabs as tab (tab.id)}
									<Tabs.Trigger
										value={tab.id}
										class="h-auto flex-none rounded-none border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-300 data-active:border-red-500 data-active:bg-red-950/20 data-active:text-gray-100"
									>
										{tab.label}
									</Tabs.Trigger>
								{/each}
							</Tabs.List>
							<Tabs.Content value="os" class="mt-3">
								<div class="relative">
									<input
										bind:value={imagesSearch}
										placeholder="Search images..."
										class="h-8 w-full border border-gray-700 bg-gray-800 px-3 text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
									/>
								</div>
								<div class="mt-3 grid grid-cols-2 gap-px bg-gray-900">
									{#each filteredOfficialImages() as img (img.id)}
										{@const isSelected = selectedImageId === img.id}
										<div class="contents">
											<button
												class="relative flex gap-4 overflow-hidden bg-gray-900 p-5 text-left transition-colors hover:bg-gray-800/40 {isSelected
													? 'ring-2 ring-red-500 ring-inset'
													: ''}"
												onclick={() => selectImage(img.id)}
											>
												<div
													class="pointer-events-none absolute inset-0 opacity-[0.08]"
													style="background: linear-gradient(135deg, {img.accentColor} 0%, transparent 60%)"
												></div>
												<div class="relative shrink-0">
													{#if img.logoSvg}
														<span
															class="flex h-12 w-12 items-center justify-center text-foreground [&_svg]:fill-current"
															>{@html img.logoSvg}</span
														>
													{:else}
														<HardDrive class="h-12 w-12 text-gray-300" />
													{/if}
												</div>
												<div class="relative flex min-w-0 flex-1 flex-col">
													<span class="text-sm font-semibold text-gray-50">{img.name}</span>
													<p class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-gray-500">
														{img.description}
													</p>
													<p class="mt-auto pt-2 text-[10px] leading-none text-gray-600">
														x86 | {img.version} | {img.imageType}
													</p>
												</div>
											</button>
											{#if isSelected}
												<div class="col-span-2 border-t border-gray-800 bg-gray-900/50 px-5 py-3">
													<span class="text-xs text-gray-400">Version</span>
													<select
														bind:value={selectedImageVersion}
														class="mt-1.5 h-8 w-full border border-gray-700 bg-gray-800 px-2 text-xs text-gray-100 focus:border-red-500 focus:outline-none"
													>
														<option value={img.version}>{img.version} (x86)</option>
													</select>
												</div>
											{/if}
										</div>
									{/each}
								</div>
								{#if filteredOfficialImages().length === 0 && imagesSearch.trim()}
									<div class="py-6 text-center text-xs text-gray-500">
										No images match "{imagesSearch}"
									</div>
								{/if}

								{#if customDbImages.length > 0}
									<div class="mt-4">
										<div class="flex items-center gap-2 border-b border-gray-800/50 pb-2">
											<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
												>Database Images</span
											>
										</div>
										<div class="mt-2 divide-y divide-gray-800/30">
											{#each customDbImages as img (img.id)}
												<button
													class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-800/20 {selectedImageId ===
													img.id
														? 'border-l-2 border-l-red-500 bg-gray-800/40'
														: ''}"
													onclick={() => {
														if (selectedImageId === img.id) {
															selectedImageId = null;
															selectedImageVersion = null;
														} else {
															selectedImageId = img.id;
															selectedImageVersion = img.version || null;
														}
													}}
												>
													<HardDrive class="h-3.5 w-3.5 text-gray-500" />
													<span class="text-xs text-gray-200">{img.name}</span>
													{#if img.version}
														<span class="text-[10px] text-gray-500">{img.version}</span>
													{/if}
												</button>
											{/each}
										</div>
									</div>
								{/if}
							</Tabs.Content>
							<Tabs.Content
								value="snapshots"
								class="mt-6 flex flex-col items-center justify-center py-8 text-center"
							>
								<HardDrive class="mb-3 h-8 w-8 text-gray-600" />
								<p class="text-xs text-gray-500">Snapshots coming soon</p>
								<p class="mt-1 max-w-xs text-[11px] text-gray-600">
									Create point-in-time copies of your servers for quick recovery.
								</p>
							</Tabs.Content>
							<Tabs.Content
								value="apps"
								class="mt-6 flex flex-col items-center justify-center py-8 text-center"
							>
								<Server class="mb-3 h-8 w-8 text-gray-600" />
								<p class="text-xs text-gray-500">Apps coming soon</p>
								<p class="mt-1 max-w-xs text-[11px] text-gray-600">
									One-click deploy popular applications like WordPress, Nextcloud, and more.
								</p>
							</Tabs.Content>
						</Tabs.Root>
					</div>

					<div id="section-plan" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
							<Server class="h-3.5 w-3.5 text-red-400" />
							<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Plan</span>
						</div>
						<div class="mt-3">
							{#if vmTypes.length === 0}
								<div class="flex flex-col items-center justify-center py-8 text-center">
									<Server class="mb-3 h-6 w-6 text-gray-600" />
									<p class="text-xs text-gray-500">No VM types available</p>
									<p class="mt-1 text-[11px] text-gray-600">
										Create a plan in the Admin panel to get started.
									</p>
								</div>
							{:else}
								<div class="grid grid-cols-2 gap-2">
									{#each vmTypes as plan (plan.id)}
										<button
											class="flex flex-col gap-1 border p-3 text-left transition-colors {selectedPlanId ===
											plan.id
												? 'border-red-500 bg-red-950/20'
												: 'border-gray-700 hover:border-gray-600'}"
											onclick={() => {
												selectedPlanId = selectedPlanId === plan.id ? null : plan.id;
											}}
										>
											<span class="text-sm font-semibold text-gray-100">{plan.name}</span>
											<div class="flex items-center gap-2 text-[11px] text-gray-400">
												<span>{plan.cores} vCPU</span>
												<span class="text-gray-700">&bull;</span>
												<span>{formatRam(plan.ramCapacity)}</span>
												<span class="text-gray-700">&bull;</span>
												<span>{plan.storageAmount}GB</span>
											</div>
											{#if plan.rate}
												<span class="text-xs font-medium text-gray-300">${plan.cap}/month</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{#if volumesEnabled}
						<div id="section-storage" class="scroll-mt-4">
							<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
								<HardDriveUpload class="h-3.5 w-3.5 text-red-400" />
								<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase"
									>Storage</span
								>
							</div>
							<div class="mt-3">
								{#if selectedPlan}
									<div class="flex items-center gap-2 text-xs text-gray-300">
										<span class="text-gray-500">Included disk:</span>
										<span class="font-medium">{selectedPlan.storageAmount}GB</span>
									</div>
								{:else}
									<p class="text-xs text-gray-500">Select a plan to see included disk size.</p>
								{/if}

								<div class="mt-4">
									<div class="flex items-center justify-between">
										<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
											>Attach Volumes</span
										>
										<button
											type="button"
											class="flex items-center gap-1 text-[10px] font-medium text-red-400 transition-colors hover:text-red-300"
											onclick={() => (showCreateVolume = !showCreateVolume)}
										>
											{#if showCreateVolume}
												<X class="h-3 w-3" />
												Cancel
											{:else}
												<Plus class="h-3 w-3" />
												Create Volume
											{/if}
										</button>
									</div>

									{#if showCreateVolume}
										<div class="mt-2 flex gap-2 border border-gray-700 bg-gray-800/40 p-3">
											<div class="flex-1">
												<label for="new-vol-name" class="mb-1 block text-[10px] text-gray-500"
													>Name</label
												>
												<input
													id="new-vol-name"
													name="newVolumeName"
													bind:value={newVolumeName}
													placeholder="volume-name"
													class="h-7 w-full border border-gray-700 bg-gray-900 px-2 text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
												/>
											</div>
											<div class="w-24">
												<label for="new-vol-size" class="mb-1 block text-[10px] text-gray-500"
													>Size (GB)</label
												>
												<input
													id="new-vol-size"
													name="newVolumeSize"
													type="number"
													min="1"
													bind:value={newVolumeSize}
													class="h-7 w-full border border-gray-700 bg-gray-900 px-2 text-xs text-gray-100 tabular-nums focus:border-gray-500 focus:outline-none"
												/>
											</div>
											<div class="flex items-end">
												<Button
													type="button"
													size="sm"
													class="h-7 px-3 text-xs"
													disabled={!newVolumeName.trim() ||
														!parseInt(newVolumeSize, 10) ||
														parseInt(newVolumeSize, 10) < 1 ||
														creatingVolume}
													onclick={createVolume}
												>
													{creatingVolume ? 'Creating...' : 'Create'}
												</Button>
											</div>
										</div>
									{/if}

									{#if availableVolumes.length > 0}
										<div class="mt-2 flex flex-col gap-1">
											{#each availableVolumes as vol (vol.id)}
												<label
													class="flex cursor-pointer items-center gap-3 border p-3 text-xs transition-colors {selectedVolumeIds.includes(
														vol.id
													)
														? 'border-red-500 bg-red-950/20'
														: 'border-gray-700 hover:border-gray-600'}"
												>
													<input
														type="checkbox"
														checked={selectedVolumeIds.includes(vol.id)}
														onchange={() => {
															if (selectedVolumeIds.includes(vol.id)) {
																selectedVolumeIds = selectedVolumeIds.filter((id) => id !== vol.id);
															} else {
																selectedVolumeIds = [...selectedVolumeIds, vol.id];
															}
														}}
														class="accent-red-500"
													/>
													<span class="font-medium text-gray-200">{vol.name}</span>
													<span class="ml-auto text-[11px] text-gray-500 tabular-nums"
														>{vol.sizeGb}GB</span
													>
												</label>
											{/each}
										</div>
									{:else}
										<div class="mt-2 border border-gray-800/50 bg-gray-900/50 p-3 text-center">
											<p class="text-xs text-gray-500">No volumes available.</p>
											<p class="mt-1 text-[11px] text-gray-600">
												Create a volume to attach it to this server.
											</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}

					<div id="section-networking" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
							<Globe class="h-3.5 w-3.5 text-red-400" />
							<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase"
								>Networking</span
							>
						</div>
						<div class="mt-3">
							<div class="flex flex-col gap-2">
								{#each [{ value: 'both' as const, label: '1 Public IPv4 Address and a IPv6 /64 block' }] as opt (opt.value)}
									<label
										class="flex cursor-pointer items-center gap-2 border p-3 text-xs transition-colors {networkingOption ===
										opt.value
											? 'border-red-500 bg-red-950/20 text-gray-100'
											: 'border-gray-700 text-gray-400 hover:border-gray-600'}"
									>
										<input
											type="radio"
											name="networking"
											value={opt.value}
											bind:group={networkingOption}
											class="accent-red-500"
										/>
										{opt.label}
									</label>
								{/each}
								<p class="text-xs text-gray-500">Advanced Networking coming soon</p>
							</div>
						</div>
					</div>

					<div id="section-ssh" class="scroll-mt-4 pb-8">
						<div class="flex items-center gap-2 border-b border-gray-800 pb-2">
							<Key class="h-3.5 w-3.5 text-red-400" />
							<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase"
								>Authentication</span
							>
						</div>
						<div class="mt-3">
							{#if data.sshKeys && data.sshKeys.length > 0}
								<p class="mb-2 text-xs text-gray-500">
									Select one or more SSH keys, or use the generated root password below.
								</p>
								<div class="flex flex-col gap-1">
									{#each data.sshKeys as key (key.id)}
										<label
											class="flex cursor-pointer items-center gap-3 border p-3 text-xs transition-colors {selectedSshKeyIds.includes(
												key.id
											)
												? 'border-red-500 bg-red-950/20'
												: 'border-gray-700 hover:border-gray-600'}"
										>
											<input
												type="checkbox"
												checked={selectedSshKeyIds.includes(key.id)}
												onchange={() => {
													if (selectedSshKeyIds.includes(key.id)) {
														selectedSshKeyIds = selectedSshKeyIds.filter((id) => id !== key.id);
													} else {
														selectedSshKeyIds = [...selectedSshKeyIds, key.id];
													}
												}}
												class="accent-red-500"
											/>
											<div class="flex flex-col">
												<span class="font-medium text-gray-200">{key.name}</span>
												<span class="font-mono text-[10px] text-gray-500"
													>{truncateFingerprint(key.fingerprint)}</span
												>
											</div>
										</label>
									{/each}
								</div>
							{:else}
								<div class="border border-gray-800/50 bg-gray-900/50 p-4 text-center">
									<p class="text-xs text-gray-500">No SSH keys available.</p>
									<p class="mt-1 text-[11px] text-gray-600">
										Password authentication will be used instead.
									</p>
									<a
										href={resolve(userSettingsHref('keys', page.url) as any)}
										data-sveltekit-noscroll
										class="mt-2 inline-flex text-[11px] font-medium text-red-400 transition-colors hover:text-red-300"
									>
										Add an SSH key in user settings
									</a>
								</div>
							{/if}
							{#if usePasswordAuthentication}
								<div class="mt-3">
									<label
										for="server-password"
										class="mb-1.5 block text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
										>Root Password</label
									>
									<div class="flex">
										<input
											id="server-password"
											name="serverPassword"
											type={showServerPassword ? 'text' : 'password'}
											bind:value={serverPassword}
											class="h-9 min-w-0 flex-1 border border-gray-700 bg-gray-800 px-3 font-mono text-xs text-gray-100 placeholder:text-gray-600 focus:border-red-500 focus:outline-none"
											placeholder="Generated password"
										/>
										<button
											type="button"
											class="flex h-9 w-9 items-center justify-center border-y border-gray-700 bg-gray-800 text-gray-400 transition-colors hover:text-gray-200"
											aria-label={showServerPassword ? 'Hide password' : 'Show password'}
											onclick={() => (showServerPassword = !showServerPassword)}
										>
											{#if showServerPassword}
												<EyeOff class="h-3.5 w-3.5" />
											{:else}
												<Eye class="h-3.5 w-3.5" />
											{/if}
										</button>
										<button
											type="button"
											class="flex h-9 w-9 items-center justify-center border border-gray-700 bg-gray-800 text-gray-400 transition-colors hover:text-gray-200"
											aria-label="Copy password"
											disabled={!serverPassword}
											onclick={copyServerPassword}
										>
											{#if passwordCopied}
												<Check class="h-3.5 w-3.5 text-emerald-500" />
											{:else}
												<Copy class="h-3.5 w-3.5" />
											{/if}
										</button>
									</div>
									<p class="mt-1.5 text-[11px] text-gray-600">
										Save this password now. It will not be shown after the server is created.
									</p>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>

		<aside class="sticky top-0 h-full w-72 shrink-0 border-l border-gray-800 bg-gray-900">
			<div class="flex h-full flex-col">
				<div class="border-b border-gray-800 px-4 py-3">
					<span class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Configure</span
					>
				</div>
				<div class="flex-1 overflow-y-auto px-4 py-3">
					<nav class="flex flex-col gap-1">
						{#each sections as section (section.id)}
							<button
								class="flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-gray-800/50"
								onclick={() => scrollTosSection(section.id)}
							>
								{#if section.isComplete}
									<Check class="h-3 w-3 shrink-0 text-emerald-500" />
								{:else}
									<Circle class="h-3 w-3 shrink-0 text-gray-600" />
								{/if}
								<span class={section.isComplete ? 'text-gray-200' : 'text-gray-500'}
									>{section.label}</span
								>
							</button>
						{/each}
					</nav>

					<div class="mt-4 border-t border-gray-800 pt-4">
						<span class="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
							>Summary</span
						>
						<div class="mt-2 flex flex-col gap-2">
							<div class="flex items-center justify-between text-xs">
								<span class="text-gray-500">Image</span>
								<span class="text-gray-200">
									{selectedImage?.name ?? '—'}
									{#if selectedImageVersion}/ {selectedImageVersion}{/if}
								</span>
							</div>
							<div class="flex items-center justify-between text-xs">
								<span class="text-gray-500">Plan</span>
								<span class="text-gray-200">
									{selectedPlan
										? `${selectedPlan.name} (${selectedPlan.cores} vCPU, ${formatRam(selectedPlan.ramCapacity)})`
										: '—'}
								</span>
							</div>
							{#if selectedPlan}
								<div class="flex items-center justify-between text-xs">
									<span class="text-gray-500">Disk</span>
									<span class="text-gray-200 tabular-nums"
										>{selectedPlan.storageAmount}GB{#if selectedVolumeCount > 0}
											+ {selectedVolumeCount} vol{/if}</span
									>
								</div>
							{/if}
							<div class="flex items-center justify-between text-xs">
								<span class="text-gray-500">Network</span>
								<span class="text-gray-200">
									{networkingOption === 'both'
										? 'IPv4 + IPv6'
										: networkingOption === 'ipv4'
											? 'IPv4 only'
											: networkingOption === 'ipv6'
												? 'IPv6 only'
												: 'None'}
								</span>
							</div>
							{#if selectedSshKeyIds.length > 0}
								<div class="flex items-center justify-between text-xs">
									<span class="text-gray-500">Authentication</span>
									<span class="text-gray-200"
										>{selectedSshKeyIds.length} SSH key{selectedSshKeyIds.length === 1
											? ''
											: 's'}</span
									>
								</div>
							{:else}
								<div class="flex items-center justify-between text-xs">
									<span class="text-gray-500">Authentication</span>
									<span class="text-gray-200">Password</span>
								</div>
							{/if}
							{#if selectedPlan?.rate}
								<div class="flex items-center justify-between text-xs">
									<span class="text-gray-500">Estimated</span>
									<span class="font-medium text-gray-100">${selectedPlan.cap}/month</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<div class="border-t border-gray-800 px-4 py-3">
					{#if !billingReady}
						<div
							class="mb-3 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200"
						>
							{#if canManageBilling}
								Set up billing before creating this server.
							{:else}
								A project owner must set up billing before servers can be created.
							{/if}
						</div>
					{/if}
					<Button
						class="w-full"
						disabled={!serverName.trim() ||
							!selectedPlanId ||
							(usePasswordAuthentication && !serverPassword.trim()) ||
							creating}
						onclick={handleCreate}
					>
						{#if creating}
							<Loader2 class="mr-2 h-3 w-3 animate-spin" />
							Creating...
						{:else}
							{billingReady ? 'Create Server' : 'Set up billing to create server'}
						{/if}
					</Button>
					{#if createError}
						<p class="mt-2 text-xs text-red-400">{createError}</p>
					{/if}
				</div>
			</div>
		</aside>
	</div>
</div>
