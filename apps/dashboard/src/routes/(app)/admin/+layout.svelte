<script lang="ts">
	import { defaultFeatureFlags, featureFlagKeys } from 'stack-shared/feature-flags';
	import type { Snippet } from 'svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Cpu from '~icons/nucleo/cpu';
	import Disc from '~icons/nucleo/disc';
	import Flag from '~icons/nucleo/flag';
	import FolderOpen from '~icons/nucleo/folder-open';
	import Mail from '~icons/nucleo/mail';
	import Megaphone from '~icons/nucleo/megaphone';
	import Network from '~icons/nucleo/network';
	import Server from '~icons/nucleo/server';
	import UserCog from '~icons/nucleo/user-cog';

	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const enabledFlags = $derived(data.featureFlags);

	const tabs = $derived([
		{
			href: resolve('admin/users'),
			label: 'Users',
			icon: UserCog,
			count: data.adminUsers.length
		},
		{
			href: resolve('admin/projects'),
			label: 'Projects',
			icon: FolderOpen,
			count: data.adminProjects.length
		},
		{
			href: resolve('admin/vms'),
			label: 'VMs',
			icon: Server,
			count: data.adminVms.filter((vm) => vm.active).length
		},
		{
			href: resolve('admin/vm-types'),
			label: 'VM Types',
			icon: Cpu,
			count: data.vmTypes.length
		},
		{
			href: resolve('admin/images'),
			label: 'Images',
			icon: Disc,
			count: data.images.length
		},
		{
			href: resolve('admin/ipam'),
			label: 'IPAM',
			icon: Network,
			count: data.ipamPrefixes.length
		},
		{
			href: resolve('admin/features'),
			label: 'Feature Flags',
			icon: Flag,
			count: featureFlagKeys.filter((key) => enabledFlags[key]).length
		},
		{
			href: resolve('admin/emails'),
			label: 'Emails',
			icon: Mail,
			count: null
		},
		{
			href: resolve('admin/announcements'),
			label: 'Announcements',
			icon: Megaphone,
			count: null
		}
	]);
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<h1 class="sr-only">Admin</h1>
	<div class="flex h-10 shrink-0 items-center gap-0 overflow-x-auto border-b border-border">
		{#each tabs as tab (tab.href)}
			{@const active =
				page.url.pathname === tab.href || page.url.pathname.startsWith(`${tab.href}/`)}
			<a
				class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {active
					? 'border-red-500 text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
				href={tab.href}
			>
				<tab.icon class="size-4 shrink-0" />
				{tab.label}
				{#if tab.count !== null}
					<Badge variant="secondary" class="text-[10px]">{tab.count}</Badge>
				{/if}
			</a>
		{/each}
	</div>
	{@render children()}
</div>
