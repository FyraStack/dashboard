<script lang="ts">
	import { untrack } from 'svelte';
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
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Ambulance from '~icons/nucleo/ambulance';
	import Camera from '~icons/nucleo/camera';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Image from '~icons/nucleo/layers';
	import LayoutGrid from '~icons/nucleo/grid';
	import Maximize from '~icons/nucleo/expand-object';
	import Network from '~icons/nucleo/network';
	import RefreshCw from '~icons/nucleo/refresh-cw';
	import Server from '~icons/nucleo/server';
	import Settings from '~icons/nucleo/settings';
	import Shield from '~icons/nucleo/shield';
	import Terminal from '~icons/nucleo/terminal';
	import Upload from '~icons/nucleo/upload';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import type { IconComponent } from '$lib';

	const featureFlagIcons: Record<FeatureFlagKey, IconComponent> = {
		colocation: Server,
		firewall: Shield,
		images: Image,
		managedHosts: Server,
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

	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	const enabledCount = $derived(featureFlagKeys.filter((k) => admin.featureFlags[k]).length);
	const totalCount = featureFlagKeys.length;

	function toggleFlag(flag: FeatureFlagKey) {
		if (admin.featureFlagSaving[flag]) return;
		admin.toggleFeatureFlag(flag, !admin.featureFlags[flag]);
	}
</script>

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if admin.featureFlagError}
			<div
				class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />{admin.featureFlagError}
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
						class="flex h-5 items-center rounded-full px-2 text-[10px] font-medium {catEnabled > 0
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
</div>
