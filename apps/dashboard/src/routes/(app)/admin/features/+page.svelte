<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import Icon from '$lib/components/icon.svelte';
	import {
		featureFlagKeys,
		featureFlagLabels,
		featureFlagDescriptions,
		featureFlagCategories,
		featureFlagCategoryLabels,
		type FeatureFlagKey,
		type FeatureFlagCategory
	} from '$lib/feature-flags';
	import Check from '~icons/lucide/check';
	import FileText from '~icons/nucleo/file-text';
	import FolderOpen from '~icons/nucleo/folder-open';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Ambulance from '~icons/nucleo/ambulance';
	import Camera from '~icons/nucleo/camera';
	import Cpu from '~icons/nucleo/cpu';
	import Disc from '~icons/nucleo/disc';
	import Flag from '~icons/nucleo/flag';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Image from '~icons/nucleo/layers';
	import LayoutGrid from '~icons/nucleo/grid';
	import Mail from '~icons/nucleo/mail';
	import Maximize from '~icons/nucleo/expand-object';
	import Network from '~icons/nucleo/network';
	import Pencil from '~icons/nucleo/pencil';
	import RefreshCw from '~icons/nucleo/refresh-cw';
	import Server from '~icons/nucleo/server';
	import Settings from '~icons/nucleo/settings';
	import Shield from '~icons/nucleo/shield';
	import Terminal from '~icons/nucleo/terminal';
	import Trash2 from '~icons/nucleo/trash';
	import Upload from '~icons/nucleo/upload';
	import UserCog from '~icons/nucleo/user-cog';
	import { AdminState, colorOptions, type AdminPageData } from '$lib/state/admin.svelte';
	import type { IconComponent } from '$lib';

	const featureFlagIcons: Record<FeatureFlagKey, IconComponent> = {
		colocation: Server,
		firewall: Shield,
		images: Image,
		volumes: HardDrive,
		vpsConsole: Terminal,
		vpsLogs: FileText,
		vpsNetworking: Network,
		vpsImages: Image,
		vpsSnapshots: Camera,
		vpsBackups: Upload,
		vpsRebuild: RefreshCw,
		vpsResize: Maximize,
		vpsRescue: Ambulance,
		vpsSettings: Settings
	};

	const categoryIcons: Record<FeatureFlagCategory, IconComponent> = {
		platform: LayoutGrid,
		server: FolderOpen
	};

	type AdminTab = 'features' | 'vmTypes' | 'images' | 'ipam' | 'users' | 'vms' | 'emails';
	let { data }: { data: AdminPageData } = $props();
	const activeTab = 'features' as AdminTab;
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	function formatSize(bytes: number) {
		const mb = bytes / (1024 * 1024);
		if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
		return `${mb.toFixed(0)} MB`;
	}

	const enabledCount = $derived(featureFlagKeys.filter((k) => admin.featureFlags[k]).length);
	const totalCount = featureFlagKeys.length;
	const userCount = $derived(admin.adminUsers.length);

	function toggleFlag(flag: FeatureFlagKey) {
		if (admin.featureFlagSaving[flag]) return;
		admin.toggleFeatureFlag(flag, !admin.featureFlags[flag]);
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Tab bar -->
	<div class="flex h-10 shrink-0 items-center gap-0 overflow-x-auto border-b border-border">
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'vmTypes'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin')}
		>
			<Cpu class="h-3.5 w-3.5 shrink-0" />
			VM Types
			<Badge variant="secondary" class="text-[10px]">{admin.vmTypes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'vms'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/vms')}
		>
			<Server class="h-3.5 w-3.5 shrink-0" />
			VMs
			<Badge variant="secondary" class="text-[10px]">
				{admin.adminVms.filter((vm) => vm.active).length}
			</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'images'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/images')}
		>
			<Disc class="h-3.5 w-3.5 shrink-0" />
			Images
			<Badge variant="secondary" class="text-[10px]">{admin.images.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'features'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/features')}
		>
			<Flag class="h-3.5 w-3.5 shrink-0" />
			Feature Flags
			<Badge variant="secondary" class="text-[10px]">{enabledCount}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'ipam'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/ipam')}
		>
			<Network class="h-3.5 w-3.5 shrink-0" />
			IPAM
			<Badge variant="secondary" class="text-[10px]">{admin.ipamPrefixes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'users'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/users')}
		>
			<UserCog class="h-3.5 w-3.5 shrink-0" />
			Users
			<Badge variant="secondary" class="text-[10px]">{userCount}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'emails'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/emails')}
		>
			<Mail class="h-3.5 w-3.5 shrink-0" />
			Emails
		</a>
		<div class="flex-1"></div>
		{#if activeTab === 'vmTypes'}
			<div class="px-4">
				<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={() => admin.vtOpenCreate()}
					><Plus class="h-3 w-3" /> Create Type</Button
				>
			</div>
		{:else if activeTab === 'images'}
			<div class="px-4">
				<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={() => admin.imgOpenCreate()}
					><Plus class="h-3 w-3" /> Add Image</Button
				>
			</div>
		{/if}
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-auto">
		{#if activeTab === 'features'}
			<div class="flex flex-col gap-5 p-5">
				{#if admin.featureFlagError}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertTriangle class="h-3.5 w-3.5 shrink-0" />{admin.featureFlagError}
					</div>
				{/if}
				<!-- Summary header -->
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="flex h-8 items-center gap-2 rounded-full bg-muted/50 px-3 text-xs font-medium text-muted-foreground"
						>
							<span class="text-muted-foreground">{enabledCount}</span>
							<span>of</span>
							<span class="text-muted-foreground">{totalCount}</span>
							<span>enabled</span>
						</div>
					</div>
				</div>

				<!-- Category cards -->
				{#each Object.entries(featureFlagCategories) as [category, flags] (category)}
					{@const CatIcon = categoryIcons[category as FeatureFlagCategory]}
					{@const catEnabled = flags.filter((f) => admin.featureFlags[f]).length}
					<div class="border border-border/60 bg-background/30">
						<div class="flex items-center justify-between border-b border-border/50 px-4 py-3">
							<div class="flex items-center gap-2.5">
								<CatIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
								<h3 class="text-sm font-semibold text-foreground">
									{featureFlagCategoryLabels[category as FeatureFlagCategory]}
								</h3>
							</div>
							<div
								class="flex h-5 items-center rounded-full px-2 text-[10px] font-medium {catEnabled >
								0
									? 'bg-emerald-500/10 text-emerald-400'
									: 'bg-muted text-muted-foreground'}"
							>
								{#if catEnabled === flags.length}
									<Check class="mr-1 h-2.5 w-2.5" />All on
								{:else if catEnabled > 0}
									{catEnabled}/{flags.length} on
								{:else}
									<X class="mr-1 h-2.5 w-2.5" />All off
								{/if}
							</div>
						</div>
						<div class="flex flex-col">
							{#each flags as flag, i (flag)}
								{@const enabled = admin.featureFlags[flag]}
								{@const Icon = featureFlagIcons[flag]}
								<div
									class="group flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-muted/20 {i !==
									flags.length - 1
										? 'border-b border-border/30'
										: ''}"
								>
									<div class="flex min-w-0 items-center gap-3">
										<div
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md {enabled
												? 'bg-red-500/10 text-red-400'
												: 'bg-muted/50 text-muted-foreground'}"
										>
											<Icon class="h-4 w-4" />
										</div>
										<div class="flex min-w-0 flex-col gap-0.5">
											<div class="flex items-center gap-2">
												<span class="text-sm font-medium text-foreground"
													>{featureFlagLabels[flag]}</span
												>
												{#if enabled}
													<span
														class="hidden items-center gap-1 text-[10px] font-medium text-emerald-400 sm:flex"
														><Check class="h-2.5 w-2.5" />Active</span
													>
												{/if}
											</div>
											<p class="text-xs text-muted-foreground">
												{featureFlagDescriptions[flag]}
											</p>
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-3">
										{#if admin.featureFlagSaving[flag]}
											<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
										{/if}
										<button
											type="button"
											class="group/toggle relative inline-flex w-9 shrink-0 items-center rounded-full border border-transparent bg-muted p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 {enabled
												? 'bg-red-600'
												: 'hover:bg-muted-foreground'}"
											onclick={() => toggleFlag(flag)}
											disabled={admin.featureFlagSaving[flag]}
											aria-label="Toggle {featureFlagLabels[flag]}"
										>
											<span
												class="block aspect-square w-1/2 rounded-full bg-white shadow-xs ring-1 ring-black/5 transition-transform duration-200 {enabled
													? 'translate-x-full'
													: 'translate-x-0'}"
											></span>
										</button>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if activeTab === 'vmTypes'}
			{#if admin.vmTypes.length === 0}
				<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
					<Cpu class="mb-3 h-6 w-6" />
					<p class="text-xs">No VM types yet</p>
					<Button
						variant="outline"
						size="sm"
						class="mt-3 gap-1.5 text-xs"
						onclick={() => admin.vtOpenCreate()}><Plus class="h-3 w-3" /> Create Type</Button
					>
				</div>
			{:else}
				<table class="w-full whitespace-nowrap">
					<thead
						><tr class="border-b border-border">
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Name</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">ISA</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Cores</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">RAM</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Storage</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Rate</th>
							<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Cap</th>
							<th class="px-5 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th
							>
						</tr></thead
					>
					<tbody class="divide-y divide-border/50">
						{#each admin.vmTypes as vt (vt.id)}
							<tr class="transition-colors hover:bg-muted/20">
								<td class="px-5 py-3 text-sm font-medium text-foreground">{vt.name}</td>
								<td class="px-5 py-3"
									><Badge variant="secondary" class="text-[10px]">{vt.isa}</Badge></td
								>
								<td class="px-5 py-3 text-sm text-muted-foreground">{vt.cores}</td>
								<td class="px-5 py-3 text-sm text-muted-foreground">{vt.ramCapacity} MB</td>
								<td class="px-5 py-3 text-sm text-muted-foreground">{vt.storageAmount} GB</td>
								<td class="px-5 py-3 text-sm text-muted-foreground">${vt.rate}/hr</td>
								<td class="px-5 py-3 text-sm text-muted-foreground">${vt.cap}/mo</td>
								<td class="px-5 py-3 text-right">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
											onclick={() => admin.vtOpenEdit(vt)}
											aria-label={`Edit ${vt.name}`}><Pencil class="h-3 w-3" /></Button
										>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
											onclick={() => admin.vtRemove(vt.id)}
											aria-label={`Delete ${vt.name}`}><Trash2 class="h-3 w-3" /></Button
										>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<!-- ═══ Images Tab ═══ -->
		{:else if admin.images.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
				<Disc class="mb-3 h-6 w-6" />
				<p class="text-xs">No admin.images configured</p>
				<Button
					variant="outline"
					size="sm"
					class="mt-3 gap-1.5 text-xs"
					onclick={() => admin.imgOpenCreate()}><Plus class="h-3 w-3" /> Add Image</Button
				>
			</div>
		{:else}
			<table class="w-full whitespace-nowrap">
				<thead
					><tr class="border-b border-border">
						<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Image</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Version</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground">ISA</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground"
							>Proxmox Path</th
						>
						<th class="px-5 py-3 text-left text-xs font-medium text-muted-foreground"
							>Description</th
						>
						<th class="px-5 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
					</tr></thead
				>
				<tbody class="divide-y divide-border/50">
					{#each admin.images as img (img.id)}
						<tr class="transition-colors hover:bg-muted/20">
							<td class="px-5 py-3">
								<div class="flex items-center gap-2.5">
									<span
										class="flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-bold text-white {img.color}"
									>
										<Disc class="h-3.5 w-3.5" />
									</span>
									<span class="text-sm font-medium text-foreground">{img.name}</span>
								</div>
							</td>
							<td class="px-5 py-3 text-sm text-muted-foreground">{img.version}</td>
							<td class="px-5 py-3"
								><Badge variant="secondary" class="text-[10px]">{img.isa}</Badge></td
							>
							<td class="max-w-xs truncate px-5 py-3 font-mono text-xs text-muted-foreground"
								>{img.filePath}</td
							>
							<td class="max-w-xs truncate px-5 py-3 text-xs text-muted-foreground"
								>{img.description}</td
							>
							<td class="px-5 py-3 text-right">
								<div class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
										onclick={() => admin.imgOpenEdit(img)}
										aria-label={`Edit ${img.name}`}><Pencil class="h-3 w-3" /></Button
									>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
										onclick={() => admin.imgRemove(img.id)}
										aria-label={`Delete ${img.name}`}><Trash2 class="h-3 w-3" /></Button
									>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<!-- VM Type Dialog -->
<Dialog.Root bind:open={admin.vtDialogOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{admin.vtEditing ? 'Edit VM Type' : 'Create VM Type'}</Dialog.Title>
			<Dialog.Description
				>{admin.vtEditing
					? 'Update plan specifications.'
					: 'Define a new VM plan.'}</Dialog.Description
			>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			{#if admin.vtError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="h-3.5 w-3.5 shrink-0" />{admin.vtError}
				</div>
			{/if}
			<div class="flex flex-col gap-2">
				<Label>Name</Label><Input bind:value={admin.vtName} placeholder="STACK-XXS" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Architecture</Label>
				<select
					bind:value={admin.vtIsa}
					class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
				>
					<option value="x86">x86</option>
				</select>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div class="flex flex-col gap-2">
					<Label>Cores</Label><Input type="number" bind:value={admin.vtCores} min="1" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>RAM (MB)</Label><Input
						type="number"
						bind:value={admin.vtRam}
						min="128"
						step="128"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Storage (GB)</Label><Input type="number" bind:value={admin.vtStorage} min="1" />
				</div>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>Rate ($/hr)</Label><Input bind:value={admin.vtRate} placeholder="0.007" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>Cap ($/mo)</Label><Input bind:value={admin.vtCap} placeholder="5.00" />
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (admin.vtDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={() => admin.vtSave()}
				disabled={admin.vtSaving || !admin.vtName.trim()}
			>
				{#if admin.vtSaving}<Loader2 class="h-3 w-3 animate-spin" />{/if}{admin.vtEditing
					? 'Save'
					: 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Image Dialog -->
<Dialog.Root bind:open={admin.imgDialogOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{admin.imgEditing ? 'Edit Image' : 'Add Image'}</Dialog.Title>
			<Dialog.Description>Configure a base image for VM provisioning.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			{#if admin.imgError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="h-3.5 w-3.5 shrink-0" />{admin.imgError}
				</div>
			{/if}

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>Name</Label><Input bind:value={admin.imgName} placeholder="Fedora Server" />
				</div>
				<div class="flex flex-col gap-2">
					<Label>Version</Label><Input bind:value={admin.imgVersion} placeholder="42" />
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label>Architecture</Label>
					<select
						bind:value={admin.imgIsa}
						class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
					>
						<option value="x86">x86</option>
					</select>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label>Description</Label>
				<textarea
					bind:value={admin.imgDescription}
					placeholder="Short description of this image..."
					rows="2"
					class="w-full resize-none border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
				></textarea>
			</div>

			<!-- Color picker -->
			<div class="flex flex-col gap-2">
				<Label>Color</Label>
				<div class="flex flex-wrap gap-1.5">
					{#each colorOptions as c (c)}
						<button
							class="h-6 w-6 border-2 transition-colors {c} {admin.imgColor === c
								? 'border-white'
								: 'border-transparent hover:border-ring'}"
							onclick={() => (admin.imgColor = c)}
							aria-label={`Select ${c}`}
						></button>
					{/each}
				</div>
			</div>

			<!-- Icon SVG -->
			<div class="flex flex-col gap-2">
				<Label
					>Icon <span class="font-normal text-muted-foreground">(icon name, optional)</span></Label
				>
				<textarea
					bind:value={admin.imgIcon}
					placeholder="logo--linux"
					rows="2"
					class="w-full resize-none border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
				></textarea>
				{#if admin.imgIcon.trim()}
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						Preview:
						<span class="flex h-7 w-7 items-center justify-center text-white {admin.imgColor}"
							>{admin.imgIcon}</span
						>
					</div>
				{/if}
			</div>

			<!-- Proxmox import image -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label>Proxmox Image</Label>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
						onclick={() => admin.loadPveImages()}
						disabled={admin.isoLoading}
					>
						{#if admin.isoLoading}<Loader2 class="h-3 w-3 animate-spin" />{:else}<RefreshCw
								class="h-3 w-3"
							/>{/if}
						Refresh
					</Button>
				</div>
				<select
					bind:value={admin.imgFilePath}
					class="h-9 w-full border border-border bg-muted px-3 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
				>
					<option value="">Select an imported Proxmox image</option>
					{#each admin.pveImages as image (image.volid)}
						<option value={image.volid}>{image.volid} · {formatSize(image.size)}</option>
					{/each}
				</select>
				{#if admin.pveImages.length > 0}
					<div class="max-h-32 overflow-y-auto border border-border">
						{#each admin.pveImages as iso (iso.volid)}
							<button
								class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors {admin.imgFilePath ===
								iso.volid
									? 'bg-red-950/30 text-foreground'
									: 'text-muted-foreground hover:bg-muted/50'}"
								onclick={() => (admin.imgFilePath = iso.volid)}
							>
								<span class="truncate font-mono">{iso.volid}</span>
								<span class="ml-2 shrink-0 text-muted-foreground">{formatSize(iso.size)}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (admin.imgDialogOpen = false)}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={() => admin.imgSave()}
				disabled={admin.imgSaving || !admin.imgName.trim() || !admin.imgFilePath.trim()}
			>
				{#if admin.imgSaving}<Loader2 class="h-3 w-3 animate-spin" />{/if}{admin.imgEditing
					? 'Save'
					: 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
