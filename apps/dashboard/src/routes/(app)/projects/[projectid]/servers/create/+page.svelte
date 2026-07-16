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
		X,
		Dices
	} from '@lucide/svelte';
	import { generateServerName } from '$lib/name-generator';

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
		ipamAvailability?: {
			ipv4: { available: boolean; availableCount: string };
			ipv6: { available: boolean; availableCount: string };
		};
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
	type ImageGroup = {
		name: string;
		description: string;
		accentColor: string;
		logoSvg: string | null;
		imageType: string;
		versions: DbImage[];
	};
	const officialImageGroups = $derived.by(() => {
		const groups = new Map<string, DbImage[]>();
		for (const image of officialDbImages) {
			const existing = groups.get(image.name);
			if (existing) existing.push(image);
			else groups.set(image.name, [image]);
		}
		return Array.from(groups.values(), (versions) => {
			const sorted = [...versions].sort((a, b) => compareVersionsDesc(a.version, b.version));
			const [representative] = sorted;
			return {
				name: representative.name,
				description: representative.description,
				accentColor: representative.accentColor,
				logoSvg: representative.logoSvg,
				imageType: representative.imageType,
				versions: sorted
			} satisfies ImageGroup;
		});
	});
	const volumesEnabled = $derived(!!data.featureFlags?.volumes);
	const projectId = $derived(data.currentProject?.id ?? page.params.projectid ?? '');
	const billingReady = $derived(data.billing?.setupRequired === false);
	const canManageBilling = $derived(Boolean(data.canManageBilling));
	const ipv4Available = $derived(Boolean(data.ipamAvailability?.ipv4.available));
	const ipv6Available = $derived(Boolean(data.ipamAvailability?.ipv6.available));
	const bothNetworksAvailable = $derived(ipv4Available && ipv6Available);

	let serverName = $state(generateServerName());
	function regenerateServerName() {
		serverName = generateServerName();
	}
	let selectedImageId = $state<string | null>(null);
	let selectedImageVersion = $state<string | null>(null);
	let selectedPlanId = $state<string | null>(null);
	let networkingOption = $state<'both' | 'ipv6'>('both');
	let selectedSshKeyIds = $state<string[]>([]);
	let serverPassword = $state('');
	let showServerPassword = $state(false);
	let passwordCopied = $state(false);
	let selectedVolumeIds = $state<string[]>([]);
	const networkingReady = $derived(
		(networkingOption === 'both' && bothNetworksAvailable) ||
			(networkingOption === 'ipv6' && ipv6Available)
	);

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

	$effect(() => {
		if (!bothNetworksAvailable && ipv6Available) networkingOption = 'ipv6';
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

	function compareVersionsDesc(a: string, b: string): number {
		const na = Number.parseFloat(a);
		const nb = Number.parseFloat(b);
		if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na;
		return b.localeCompare(a, undefined, { numeric: true });
	}

	function filteredOfficialGroups(): ImageGroup[] {
		if (!imagesSearch.trim()) return officialImageGroups;
		const q = imagesSearch.toLowerCase();
		return officialImageGroups.filter(
			(g) =>
				g.name.toLowerCase().includes(q) ||
				g.versions.some((v) => v.version.toLowerCase().includes(q))
		);
	}

	function selectImageGroup(group: ImageGroup) {
		if (group.versions.some((v) => v.id === selectedImageId)) {
			selectedImageId = null;
			selectedImageVersion = null;
		} else {
			selectedImageId = group.versions[0].id;
			selectedImageVersion = group.versions[0].version;
		}
	}

	function selectImageVersion(imageId: string) {
		const img = dbImages.find((i) => i.id === imageId);
		if (!img) return;
		selectedImageId = img.id;
		selectedImageVersion = img.version;
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
			!selectedImageId ||
			!selectedPlanId ||
			!networkingReady ||
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
			const networkingMode: 'both' | 'ipv6' = networkingOption === 'ipv6' ? 'ipv6' : 'both';
			const payload = {
				projectId,
				vmTypeId: selectedPlanId,
				name: serverName.trim(),
				networkingMode,
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

	<div
		class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 sm:h-10 sm:px-5"
	>
		<div class="flex min-w-0 items-center gap-3">
			<Button
				variant="ghost"
				size="sm"
				class="h-9 shrink-0 gap-1.5 px-2.5 text-sm text-muted-foreground hover:text-foreground sm:h-7 sm:px-2 sm:text-xs"
				onclick={() => goto(resolve(`/projects/${page.params.projectid}/servers`))}
			>
				<ArrowLeft class="h-3.5 w-3.5 sm:h-3 sm:w-3" />
				Back
			</Button>
			<span class="truncate text-base font-semibold text-foreground sm:text-sm">Create Server</span>
		</div>
	</div>

	<div class="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
		<div class="flex-1 lg:overflow-y-auto">
			<div class="px-4 py-5 sm:px-6 sm:py-6">
				<div class="flex flex-col gap-8">
					<div id="section-name" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-border pb-2">
							<Server class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
							<span
								class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
								>Name</span
							>
						</div>
						<div class="mt-3 flex">
							<Input
								bind:value={serverName}
								placeholder="my-server"
								class="h-11 text-base sm:h-9 sm:text-sm"
							/>
							<Button variant="outline" class="h-11 sm:h-9" onclick={regenerateServerName}>
								<Dices />
							</Button>
						</div>
					</div>

					<div id="section-image" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-border pb-2">
							<HardDrive class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
							<span
								class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
								>Image</span
							>
						</div>
						<Tabs.Root bind:value={() => imageTab, setImageTab} class="mt-3">
							<Tabs.List
								class="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent p-0"
							>
								{#each imageTabs as tab (tab.id)}
									<Tabs.Trigger
										value={tab.id}
										class="h-auto flex-none rounded-none border border-border px-4 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:border-ring hover:text-foreground sm:px-3 sm:py-1.5 sm:text-xs data-active:border-red-500 data-active:bg-red-950/20 data-active:text-foreground"
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
										class="h-11 w-full border border-border bg-muted px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none sm:h-8 sm:text-xs"
									/>
								</div>
								<div class="mt-3 grid grid-cols-1 gap-px bg-background sm:grid-cols-2">
									{#each filteredOfficialGroups() as group (group.name)}
										{@const isSelected = group.versions.some((v) => v.id === selectedImageId)}
										<div class="flex flex-col">
											<button
												aria-pressed={isSelected}
												aria-label={group.name}
												class="relative flex gap-4 overflow-hidden bg-background p-5 text-left transition-colors hover:bg-muted/40 {isSelected
													? 'ring-2 ring-red-500 ring-inset'
													: ''}"
												onclick={() => selectImageGroup(group)}
											>
												<div
													class="pointer-events-none absolute inset-0 opacity-[0.08]"
													style="background: linear-gradient(135deg, {group.accentColor} 0%, transparent 60%)"
												></div>
												<div class="relative shrink-0">
													{#if group.logoSvg}
														<span
															class="flex h-12 w-12 items-center justify-center text-foreground [&_svg]:fill-current"
															>{@html group.logoSvg}</span
														>
													{:else}
														<HardDrive class="h-12 w-12 text-muted-foreground" />
													{/if}
												</div>
												<div class="relative flex min-w-0 flex-1 flex-col">
													<span class="text-base font-semibold text-foreground sm:text-sm"
														>{group.name}</span
													>
													<p
														class="mt-0.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:text-[11px]"
													>
														{group.description}
													</p>
													<p
														class="mt-auto pt-2 text-xs leading-none text-muted-foreground sm:text-[10px]"
													>
														x86 | {group.versions.length > 1
															? `${group.versions.length} versions`
															: group.versions[0].version} | {group.imageType}
													</p>
												</div>
											</button>
											{#if isSelected}
												<div class="border-t border-border bg-background/50 px-5 py-3">
													<span class="text-sm text-muted-foreground sm:text-xs">Version</span>
													<select
														value={selectedImageId}
														onchange={(e) => selectImageVersion(e.currentTarget.value)}
														class="mt-1.5 h-11 w-full border border-border bg-muted px-2 text-base text-foreground focus:border-red-500 focus:outline-none sm:h-8 sm:text-xs"
													>
														{#each group.versions as v (v.id)}
															<option value={v.id}>{v.version} (x86)</option>
														{/each}
													</select>
												</div>
											{/if}
										</div>
									{/each}
								</div>
								{#if filteredOfficialGroups().length === 0 && imagesSearch.trim()}
									<div class="py-6 text-center text-sm text-muted-foreground sm:text-xs">
										No images match "{imagesSearch}"
									</div>
								{/if}

								{#if customDbImages.length > 0}
									<div class="mt-4">
										<div class="flex items-center gap-2 border-b border-border/50 pb-2">
											<span
												class="text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:text-[10px]"
												>Database Images</span
											>
										</div>
										<div class="mt-2 divide-y divide-border/30">
											{#each customDbImages as img (img.id)}
												<button
													aria-pressed={selectedImageId === img.id}
													class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/20 sm:py-2.5 {selectedImageId ===
													img.id
														? 'border-l-2 border-l-red-500 bg-muted/40'
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
													<HardDrive
														class="h-4 w-4 shrink-0 text-muted-foreground sm:h-3.5 sm:w-3.5"
													/>
													<span class="truncate text-sm text-foreground sm:text-xs">{img.name}</span
													>
													{#if img.version}
														<span class="shrink-0 text-xs text-muted-foreground sm:text-[10px]"
															>{img.version}</span
														>
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
								<HardDrive class="mb-3 h-8 w-8 text-muted-foreground" />
								<p class="text-sm text-muted-foreground sm:text-xs">Snapshots coming soon</p>
								<p class="mt-1 max-w-xs text-sm text-muted-foreground sm:text-[11px]">
									Create point-in-time copies of your servers for quick recovery.
								</p>
							</Tabs.Content>
							<Tabs.Content
								value="apps"
								class="mt-6 flex flex-col items-center justify-center py-8 text-center"
							>
								<Server class="mb-3 h-8 w-8 text-muted-foreground" />
								<p class="text-sm text-muted-foreground sm:text-xs">Apps coming soon</p>
								<p class="mt-1 max-w-xs text-sm text-muted-foreground sm:text-[11px]">
									One-click deploy popular applications like WordPress, Nextcloud, and more.
								</p>
							</Tabs.Content>
						</Tabs.Root>
					</div>

					<div id="section-plan" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-border pb-2">
							<Server class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
							<span
								class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
								>Plan</span
							>
						</div>
						<div class="mt-3">
							{#if vmTypes.length === 0}
								<div class="flex flex-col items-center justify-center py-8 text-center">
									<Server class="mb-3 h-6 w-6 text-muted-foreground" />
									<p class="text-sm text-muted-foreground sm:text-xs">No VM types available</p>
									<p class="mt-1 text-sm text-muted-foreground sm:text-[11px]">
										Create a plan in the Admin panel to get started.
									</p>
								</div>
							{:else}
								<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
									{#each vmTypes as plan (plan.id)}
										<button
											aria-pressed={selectedPlanId === plan.id}
											aria-label={`${plan.name} plan`}
											class="flex flex-col gap-1 border p-4 text-left transition-colors sm:p-3 {selectedPlanId ===
											plan.id
												? 'border-red-500 bg-red-950/20'
												: 'border-border hover:border-ring'}"
											onclick={() => {
												selectedPlanId = selectedPlanId === plan.id ? null : plan.id;
											}}
										>
											<span class="text-base font-semibold text-foreground sm:text-sm"
												>{plan.name}</span
											>
											<div
												class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-[11px]"
											>
												<span>{plan.cores} vCPU</span>
												<span class="text-muted-foreground">&bull;</span>
												<span>{formatRam(plan.ramCapacity)}</span>
												<span class="text-muted-foreground">&bull;</span>
												<span>{plan.storageAmount}GB</span>
											</div>
											{#if plan.cap}
												<span class="text-sm font-medium text-muted-foreground sm:text-xs"
													>${plan.cap}/month</span
												>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{#if volumesEnabled}
						<div id="section-storage" class="scroll-mt-4">
							<div class="flex items-center gap-2 border-b border-border pb-2">
								<HardDriveUpload class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
								<span
									class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
									>Storage</span
								>
							</div>
							<div class="mt-3">
								{#if selectedPlan}
									<div class="flex items-center gap-2 text-sm text-muted-foreground sm:text-xs">
										<span class="text-muted-foreground">Included disk:</span>
										<span class="font-medium">{selectedPlan.storageAmount}GB</span>
									</div>
								{:else}
									<p class="text-sm text-muted-foreground sm:text-xs">
										Select a plan to see included disk size.
									</p>
								{/if}

								<div class="mt-4">
									<div class="flex items-center justify-between">
										<span
											class="text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:text-[10px]"
											>Attach Volumes</span
										>
										<button
											type="button"
											class="relative flex items-center gap-1 py-1 text-xs font-medium text-red-400 transition-colors hover:text-red-300 sm:text-[10px]"
											onclick={() => (showCreateVolume = !showCreateVolume)}
										>
											<span
												class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
												aria-hidden="true"
											></span>
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
										<div
											class="mt-2 flex flex-col gap-2 border border-border bg-muted/40 p-3 sm:flex-row"
										>
											<div class="min-w-0 flex-1">
												<label
													for="new-vol-name"
													class="mb-1 block text-xs text-muted-foreground sm:text-[10px]"
													>Name</label
												>
												<input
													id="new-vol-name"
													name="newVolumeName"
													bind:value={newVolumeName}
													placeholder="volume-name"
													class="h-10 w-full border border-border bg-background px-2 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none sm:h-7 sm:text-xs"
												/>
											</div>
											<div class="sm:w-24">
												<label
													for="new-vol-size"
													class="mb-1 block text-xs text-muted-foreground sm:text-[10px]"
													>Size (GB)</label
												>
												<input
													id="new-vol-size"
													name="newVolumeSize"
													type="number"
													min="1"
													bind:value={newVolumeSize}
													class="h-10 w-full border border-border bg-background px-2 text-base text-foreground tabular-nums focus:border-ring focus:outline-none sm:h-7 sm:text-xs"
												/>
											</div>
											<div class="flex items-end">
												<Button
													type="button"
													size="sm"
													class="h-10 w-full px-3 text-sm sm:h-7 sm:w-auto sm:text-xs"
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
													class="flex cursor-pointer items-center gap-3 border p-3 text-sm transition-colors sm:text-xs {selectedVolumeIds.includes(
														vol.id
													)
														? 'border-red-500 bg-red-950/20'
														: 'border-border hover:border-ring'}"
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
														class="h-5 w-5 shrink-0 accent-red-500 sm:h-4 sm:w-4"
													/>
													<span class="min-w-0 truncate font-medium text-foreground"
														>{vol.name}</span
													>
													<span
														class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums sm:text-[11px]"
														>{vol.sizeGb}GB</span
													>
												</label>
											{/each}
										</div>
									{:else}
										<div class="mt-2 border border-border/50 bg-background/50 p-3 text-center">
											<p class="text-sm text-muted-foreground sm:text-xs">No volumes available.</p>
											<p class="mt-1 text-sm text-muted-foreground sm:text-[11px]">
												Create a volume to attach it to this server.
											</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}

					<div id="section-networking" class="scroll-mt-4">
						<div class="flex items-center gap-2 border-b border-border pb-2">
							<Globe class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
							<span
								class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
								>Networking</span
							>
						</div>
						<div class="mt-3">
							<div class="flex flex-col gap-2">
								{#each [{ value: 'both' as const, label: '1 Public IPv4 Address and an IPv6 block', disabled: !bothNetworksAvailable }, { value: 'ipv6' as const, label: 'IPv6 block only', disabled: !ipv6Available }] as opt (opt.value)}
									<label
										class="flex items-center gap-2 border p-3 text-sm transition-colors sm:text-xs {opt.disabled
											? 'cursor-not-allowed border-border text-muted-foreground'
											: networkingOption === opt.value
												? 'cursor-pointer border-red-500 bg-red-950/20 text-foreground'
												: 'cursor-pointer border-border text-muted-foreground hover:border-ring'}"
									>
										<input
											type="radio"
											name="networking"
											value={opt.value}
											bind:group={networkingOption}
											disabled={opt.disabled}
											class="h-5 w-5 shrink-0 accent-red-500 sm:h-4 sm:w-4"
										/>
										{opt.label}
										{#if opt.disabled}
											<span class="ml-auto shrink-0 text-xs text-muted-foreground sm:text-[11px]"
												>Exhausted</span
											>
										{/if}
									</label>
								{/each}
								{#if !ipv6Available}
									<p class="text-sm text-red-400 sm:text-xs">
										No IPv6 capacity is currently available.
									</p>
								{/if}
							</div>
						</div>
					</div>

					<div id="section-ssh" class="scroll-mt-4 pb-8">
						<div class="flex items-center gap-2 border-b border-border pb-2">
							<Key class="h-4 w-4 shrink-0 text-red-400 sm:h-3.5 sm:w-3.5" />
							<span
								class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
								>Authentication</span
							>
						</div>
						<div class="mt-3">
							{#if data.sshKeys && data.sshKeys.length > 0}
								<p class="mb-2 text-sm text-muted-foreground sm:text-xs">
									Select one or more <a
										href="https://fyrastack.com/docs/vps/ssh"
										target="_blank"
										rel="noopener noreferrer"
										class="text-red-400 transition-colors hover:text-red-300">SSH keys</a
									>, or use the generated root password below.
								</p>
								<div class="flex flex-col gap-1">
									{#each data.sshKeys as key (key.id)}
										<label
											class="flex cursor-pointer items-center gap-3 border p-3 text-sm transition-colors sm:text-xs {selectedSshKeyIds.includes(
												key.id
											)
												? 'border-red-500 bg-red-950/20'
												: 'border-border hover:border-ring'}"
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
												class="h-5 w-5 shrink-0 accent-red-500 sm:h-4 sm:w-4"
											/>
											<div class="flex min-w-0 flex-col">
												<span class="truncate font-medium text-foreground">{key.name}</span>
												<span
													class="truncate font-mono text-xs text-muted-foreground sm:text-[10px]"
													>{truncateFingerprint(key.fingerprint)}</span
												>
											</div>
										</label>
									{/each}
								</div>
							{:else}
								<div class="border border-border/50 bg-background/50 p-4 text-center">
									<p class="text-sm text-muted-foreground sm:text-xs">
										No <a
											href="https://fyrastack.com/docs/vps/ssh"
											target="_blank"
											rel="noopener noreferrer"
											class="text-red-400 transition-colors hover:text-red-300">SSH keys</a
										> available.
									</p>
									<p class="mt-1 text-sm text-muted-foreground sm:text-[11px]">
										Password authentication will be used instead.
									</p>
									<a
										href={resolve(userSettingsHref('keys', page.url) as any)}
										data-sveltekit-noscroll
										class="mt-2 inline-flex py-1 text-sm font-medium text-red-400 transition-colors hover:text-red-300 sm:py-0 sm:text-[11px]"
									>
										Add an SSH key in user settings
									</a>
								</div>
							{/if}
							{#if usePasswordAuthentication}
								<div class="mt-3">
									<label
										for="server-password"
										class="mb-1.5 block text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:text-[10px]"
										>Root Password</label
									>
									<div class="flex">
										<input
											id="server-password"
											name="serverPassword"
											type={showServerPassword ? 'text' : 'password'}
											bind:value={serverPassword}
											class="h-11 min-w-0 flex-1 border border-border bg-muted px-3 font-mono text-base text-foreground placeholder:text-muted-foreground focus:border-red-500 focus:outline-none sm:h-9 sm:text-xs"
											placeholder="Generated password"
										/>
										<button
											type="button"
											class="flex h-11 w-11 shrink-0 items-center justify-center border-y border-border bg-muted text-muted-foreground transition-colors hover:text-foreground sm:h-9 sm:w-9"
											aria-label={showServerPassword ? 'Hide password' : 'Show password'}
											onclick={() => (showServerPassword = !showServerPassword)}
										>
											{#if showServerPassword}
												<EyeOff class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
											{:else}
												<Eye class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
											{/if}
										</button>
										<button
											type="button"
											class="flex h-11 w-11 shrink-0 items-center justify-center border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground sm:h-9 sm:w-9"
											aria-label="Copy password"
											disabled={!serverPassword}
											onclick={copyServerPassword}
										>
											{#if passwordCopied}
												<Check class="h-4 w-4 text-emerald-500 sm:h-3.5 sm:w-3.5" />
											{:else}
												<Copy class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
											{/if}
										</button>
									</div>
									<p class="mt-1.5 text-sm text-muted-foreground sm:text-[11px]">
										Save this password now. It will not be shown after the server is created.
									</p>
								</div>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</div>

		<aside
			class="w-full shrink-0 border-t border-border bg-background lg:sticky lg:top-0 lg:h-full lg:w-72 lg:border-t-0 lg:border-l"
		>
			<div class="flex h-full flex-col">
				<div class="border-b border-border px-4 py-3">
					<span
						class="text-sm font-semibold tracking-wider text-muted-foreground uppercase sm:text-xs"
						>Configure</span
					>
				</div>
				<div class="flex-1 overflow-y-auto px-4 py-3">
					<nav class="flex flex-col gap-1">
						{#each sections as section (section.id)}
							<button
								class="flex items-center gap-2 px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 sm:py-1.5 sm:text-xs"
								onclick={() => scrollTosSection(section.id)}
							>
								{#if section.isComplete}
									<Check class="h-3 w-3 shrink-0 text-emerald-500" />
								{:else}
									<Circle class="h-3 w-3 shrink-0 text-muted-foreground" />
								{/if}
								<span class={section.isComplete ? 'text-foreground' : 'text-muted-foreground'}
									>{section.label}</span
								>
							</button>
						{/each}
					</nav>

					<div class="mt-4 border-t border-border pt-4">
						<span
							class="text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:text-[10px]"
							>Summary</span
						>
						<div class="mt-2 flex flex-col gap-2">
							<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
								<span class="text-muted-foreground">Image</span>
								<span class="min-w-0 truncate text-right text-foreground">
									{selectedImage?.name ?? '—'}
									{#if selectedImageVersion}/ {selectedImageVersion}{/if}
								</span>
							</div>
							<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
								<span class="text-muted-foreground">Plan</span>
								<span class="min-w-0 truncate text-right text-foreground">
									{selectedPlan
										? `${selectedPlan.name} (${selectedPlan.cores} vCPU, ${formatRam(selectedPlan.ramCapacity)})`
										: '—'}
								</span>
							</div>
							{#if selectedPlan}
								<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
									<span class="text-muted-foreground">Disk</span>
									<span class="min-w-0 truncate text-right text-foreground tabular-nums"
										>{selectedPlan.storageAmount}GB{#if selectedVolumeCount > 0}
											+ {selectedVolumeCount} vol{/if}</span
									>
								</div>
							{/if}
							<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
								<span class="text-muted-foreground">Network</span>
								<span class="min-w-0 truncate text-right text-foreground">
									{networkingOption === 'both' ? 'IPv4 + IPv6' : 'IPv6 only'}
								</span>
							</div>
							{#if selectedSshKeyIds.length > 0}
								<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
									<span class="text-muted-foreground">Authentication</span>
									<span class="min-w-0 truncate text-right text-foreground"
										>{selectedSshKeyIds.length} SSH key{selectedSshKeyIds.length === 1
											? ''
											: 's'}</span
									>
								</div>
							{:else}
								<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
									<span class="text-muted-foreground">Authentication</span>
									<span class="min-w-0 truncate text-right text-foreground">Password</span>
								</div>
							{/if}
							{#if selectedPlan?.cap}
								<div class="flex items-center justify-between gap-3 text-sm sm:text-xs">
									<span class="text-muted-foreground">Estimated</span>
									<span class="font-medium text-foreground">${selectedPlan.cap}/month</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<div class="border-t border-border px-4 py-3">
					{#if !billingReady}
						<div
							class="mb-3 rounded-md border border-amber-300 bg-amber-100 p-3 text-sm text-amber-800 sm:text-xs dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"
						>
							{#if canManageBilling}
								Set up billing before creating this server.
							{:else}
								A project owner must set up billing before servers can be created.
							{/if}
						</div>
					{/if}
					<Button
						class="h-11 w-full text-sm sm:h-9"
						disabled={!serverName.trim() ||
							!selectedImageId ||
							!selectedPlanId ||
							(usePasswordAuthentication && !serverPassword.trim()) ||
							!networkingReady ||
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
						<p class="mt-2 text-sm text-red-400 sm:text-xs">{createError}</p>
					{/if}
				</div>
			</div>
		</aside>
	</div>
</div>
