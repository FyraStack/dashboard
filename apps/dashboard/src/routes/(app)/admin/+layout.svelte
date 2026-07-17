<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge';
	import { featureFlagKeys } from '$lib/feature-flags';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import Cpu from '~icons/nucleo/cpu';
	import Disc from '~icons/nucleo/disc';
	import Flag from '~icons/nucleo/flag';
	import FolderOpen from '~icons/nucleo/folder-open';
	import Mail from '~icons/nucleo/mail';
	import Network from '~icons/nucleo/network';
	import Server from '~icons/nucleo/server';
	import UserCog from '~icons/nucleo/user-cog';

	let { data, children }: { data: AdminPageData; children: Snippet } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	const tabs = $derived([
		{
			href: resolve('/admin/users'),
			label: 'Users',
			icon: UserCog,
			count: admin.adminUsers.length
		},
		{
			href: resolve('/admin/projects'),
			label: 'Projects',
			icon: FolderOpen,
			count: admin.adminProjects.length
		},
		{
			href: resolve('/admin/vms'),
			label: 'VMs',
			icon: Server,
			count: admin.adminVms.filter((vm) => vm.active).length
		},
		{
			href: resolve('/admin/vm-types'),
			label: 'VM Types',
			icon: Cpu,
			count: admin.vmTypes.length
		},
		{
			href: resolve('/admin/images'),
			label: 'Images',
			icon: Disc,
			count: admin.images.length
		},
		{
			href: resolve('/admin/ipam'),
			label: 'IPAM',
			icon: Network,
			count: admin.ipamPrefixes.length
		},
		{
			href: resolve('/admin/features'),
			label: 'Feature Flags',
			icon: Flag,
			count: featureFlagKeys.filter((key) => admin.featureFlags[key]).length
		},
		{
			href: resolve('/admin/emails'),
			label: 'Emails',
			icon: Mail,
			count: null
		}
	]);
</script>

<div class="flex flex-1 flex-col overflow-hidden">
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
