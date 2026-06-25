<script lang="ts">
	import { page } from '$app/state';
	import UserSettingsDialog from '$lib/components/dialogs/user-settings-dialog.svelte';
	import {
		clearUserSettingsHref,
		UserSettingsState,
		type UserSettingsTab
	} from '$lib/state/user-settings.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	import * as Command from '$lib/components/ui/command';
	import * as Sheet from '$lib/components/ui/sheet';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { listVms } from '$lib/remote/vms.remote';
	import { authClient } from '$lib/auth-client';
	import type { FeatureFlags } from '$lib/feature-flags';
	import {
		Server,
		HardDrive,
		Shield,
		Warehouse,
		Disc,
		Settings,
		Search,
		ArrowRight,
		User,
		Key,
		KeyRound,
		CreditCard,
		Check,
		ChevronDown,
		FolderOpen,
		Menu
	} from '@lucide/svelte';

	let { children, data } = $props();
	let mobileNavOpen = $state(false);
	const featureFlags = $derived((data.featureFlags ?? {}) as FeatureFlags);

	// Projects — from server
	type ProjectRole = 'owner' | 'admin' | 'read_write' | 'read';
	type Project = { id: string; projectName: string; role: ProjectRole };
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state('');
	let currentProject = $derived(
		projects.find((project) => project.id === selectedProjectId) ??
			(data.currentProject
				? {
						id: data.currentProject.id,
						projectName: data.currentProject.projectName,
						role: data.currentProject.role
					}
				: null)
	);

	$effect(() => {
		const incoming = data.projects ?? [];
		const currentProjectId = data.currentProject?.id ?? incoming[0]?.id ?? '';
		untrack(() => {
			projects = incoming;
			selectedProjectId = currentProjectId;
		});
	});

	const isOnProjectRoute = $derived(page.url.pathname.startsWith('/projects/'));
	const isRootPage = $derived(page.url.pathname === '/');
	const isAdminPage = $derived(page.url.pathname.startsWith('/admin'));
	const currentProjectSection = $derived.by(() => {
		const segment = page.url.pathname.match(/^\/projects\/[^/]+\/([^/]+)/)?.[1];
		if (!segment) return '';
		return segment
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	});

	const projectUrlPrefix = $derived(currentProject ? `/projects/${currentProject.id}` : '');

	const navItems = $derived.by(() => {
		const items: { icon: typeof Server; label: string; href: string }[] = [];
		if (!currentProject) return items;
		const prefix = `/projects/${currentProject.id}`;
		items.push({ icon: Server, label: 'Servers', href: `${prefix}/servers` });
		if (featureFlags.colocation)
			items.push({ icon: Warehouse, label: 'Colocation', href: `${prefix}/colocation` });
		if (featureFlags.volumes)
			items.push({ icon: HardDrive, label: 'Volumes', href: `${prefix}/volumes` });
		if (featureFlags.firewall)
			items.push({ icon: Shield, label: 'Firewall', href: `${prefix}/firewall` });
		if (featureFlags.images) items.push({ icon: Disc, label: 'Images', href: `${prefix}/images` });
		items.push({ icon: CreditCard, label: 'Billing', href: `${prefix}/billing` });
		items.push({ icon: Settings, label: 'Settings', href: `${prefix}/settings` });
		return items;
	});

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		if (href.startsWith('/projects/')) {
			return page.url.pathname.startsWith(href);
		}
		return page.url.pathname.startsWith(href);
	}

	function withProjectContext(href: string, projectId = selectedProjectId) {
		if (!projectId) return href;
		if (href.startsWith('/projects/')) return href;
		return `/projects/${projectId}${href}`;
	}

	$effect(() => {
		// Sync selectedProjectId from URL when on a project route
		if (isOnProjectRoute) {
			const match = page.url.pathname.match(/^\/projects\/([^/]+)/);
			if (match) {
				selectedProjectId = match[1];
			}
		}
	});

	async function selectProject(projectId: string) {
		if (!projectId || projectId === selectedProjectId) return;
		selectedProjectId = projectId;
		await authClient.organization.setActive({ organizationId: projectId });
		await goto(resolve(`/projects/${projectId}/servers`));
	}

	const userSettings = new UserSettingsState();
	let profileName = $state('');

	$effect(() => {
		const user = data.user;
		untrack(() => {
			if (user) {
				profileName = user.name ?? '';
			}
		});
	});

	function openUserSettings(tab: UserSettingsTab = 'profile') {
		userSettings.show(tab);
	}

	$effect(() => {
		userSettings.syncFromUrl(page.url);
	});

	$effect(() => {
		if (!userSettings.open && userSettings.urlHasSettingsTab(page.url)) {
			replaceState(resolve(clearUserSettingsHref(page.url) as any), page.state);
		}
	});

	// Command palette
	let commandOpen = $state(false);
	let commandSearch = $state('');
	type CmdFilter = 'all' | 'navigate' | 'servers' | 'account';
	let cmdFilter = $state<CmdFilter>('all');
	type CommandServer = {
		id: string;
		name: string;
		plan: string;
		status: string;
		detail: string;
	};
	type CommandEntry = {
		icon: typeof Server;
		label: string;
		href?: string;
		action?: () => void | Promise<void>;
	};
	let commandServers = $state.raw<CommandServer[]>([]);
	let commandServersLoading = $state(false);
	let commandServersLoadedProjectId = $state<string | null>(null);
	let commandServersRequestId = 0;

	const normalizedCommandSearch = $derived(commandSearch.trim().toLowerCase());
	const filteredCommandServers = $derived.by(() =>
		commandServers.filter((server) =>
			matchesCommandSearch([server.name, server.plan, server.status, server.detail])
		)
	);
	const showServerFilter = $derived(commandServersLoading || commandServers.length > 0);
	const cmdFilters = $derived.by(() => {
		const filters: { id: CmdFilter; label: string; icon: typeof Server }[] = [
			{ id: 'all', label: 'All', icon: Search },
			{ id: 'navigate', label: 'Pages', icon: ArrowRight }
		];
		if (showServerFilter) filters.push({ id: 'servers', label: 'Servers', icon: Server });
		filters.push({ id: 'account', label: 'Account', icon: User });
		return filters;
	});

	const navigateCommands = $derived.by(() => {
		const commands: CommandEntry[] = [{ icon: Server, label: 'Servers', href: '/servers' }];
		if (showColocation)
			commands.push({ icon: Warehouse, label: 'Colocation', href: '/colocation' });
		if (showVolumes) commands.push({ icon: HardDrive, label: 'Volumes', href: '/volumes' });
		if (showFirewall) commands.push({ icon: Shield, label: 'Firewall', href: '/firewall' });
		if (showImages) commands.push({ icon: Disc, label: 'Images', href: '/images' });
		return commands;
	});
	const accountCommands: CommandEntry[] = [
		{ icon: User, label: 'Profile', action: () => openUserSettings('profile') },
		{ icon: Key, label: 'SSH Keys', action: () => openUserSettings('keys') },
		{ icon: KeyRound, label: 'API Tokens', action: () => openUserSettings('api') },
		{ icon: KeyRound, label: 'Change Password', action: () => openUserSettings('security') }
	];
	const filteredNavigateCommands = $derived.by(() =>
		navigateCommands.filter((command) => matchesCommandSearch([command.label]))
	);
	const filteredAccountCommands = $derived.by(() =>
		accountCommands.filter((command) => matchesCommandSearch([command.label]))
	);
	const showServersGroup = $derived(
		(cmdFilter === 'all' || cmdFilter === 'servers') &&
			(commandServersLoading || filteredCommandServers.length > 0)
	);
	const showNavigateGroup = $derived(
		(cmdFilter === 'all' || cmdFilter === 'navigate') && filteredNavigateCommands.length > 0
	);
	const showAccountGroup = $derived(
		(cmdFilter === 'all' || cmdFilter === 'account') && filteredAccountCommands.length > 0
	);

	function matchesCommandSearch(values: (string | null | undefined)[]) {
		if (!normalizedCommandSearch) return true;
		return values.some((value) => value?.toLowerCase().includes(normalizedCommandSearch));
	}

	function formatVmStatus(status: string, liveStatus?: string | null) {
		if (liveStatus === 'running') return 'Running';
		if (status === 'provisioning') return 'Provisioning';
		if (status === 'error') return 'Error';
		if (!liveStatus || liveStatus === 'unknown') return 'Ready';
		return liveStatus.charAt(0).toUpperCase() + liveStatus.slice(1);
	}

	async function loadCommandServers(projectId = selectedProjectId) {
		if (!projectId || commandServersLoading || commandServersLoadedProjectId === projectId) return;
		const requestId = ++commandServersRequestId;
		commandServersLoading = true;

		try {
			const vms = await listVms({ projectId }).run();
			if (requestId !== commandServersRequestId) return;
			commandServers = vms
				.filter((vm) => vm.active)
				.map((vm) => ({
					id: vm.id,
					name: vm.name,
					plan: vm.vmType?.name ?? 'Custom',
					status: formatVmStatus(vm.status, vm.live?.status),
					detail:
						[
							vm.vmType?.cores ? `${vm.vmType.cores} vCPU` : null,
							vm.vmType?.ramCapacity ? `${vm.vmType.ramCapacity}MB RAM` : null,
							vm.vmType?.storageAmount ? `${vm.vmType.storageAmount}GB disk` : null
						]
							.filter(Boolean)
							.join(' • ') || 'Server'
				}));
			commandServersLoadedProjectId = projectId;
		} catch (error) {
			if (requestId !== commandServersRequestId) return;
			toast.error(getErrorMessage(error, 'Failed to load servers'));
			commandServers = [];
			commandServersLoadedProjectId = projectId;
		} finally {
			if (requestId === commandServersRequestId) commandServersLoading = false;
		}
	}

	function openCommandPalette() {
		commandSearch = '';
		cmdFilter = 'all';
		commandOpen = true;
	}

	$effect(() => {
		const projectId = selectedProjectId;
		untrack(() => {
			if (commandServersLoadedProjectId === projectId && !commandServersLoading) return;
			commandServers = [];
			commandServersLoadedProjectId = null;
			commandServersRequestId += 1;
			commandServersLoading = false;
		});
	});

	$effect(() => {
		if (!commandOpen || !selectedProjectId) return;
		untrack(() => loadCommandServers(selectedProjectId));
	});

	$effect(() => {
		if (cmdFilter === 'servers' && !showServerFilter) cmdFilter = 'all';
	});

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			if (commandOpen) {
				commandOpen = false;
			} else {
				openCommandPalette();
			}
		}
		if (commandOpen && e.key === 'Tab') {
			e.preventDefault();
			const ids = cmdFilters.map((f) => f.id);
			const idx = ids.indexOf(cmdFilter);
			cmdFilter = ids[(idx + (e.shiftKey ? ids.length - 1 : 1)) % ids.length];
		}
	}

	function runCommand(fn: () => void | Promise<void>) {
		commandOpen = false;
		fn();
	}

	const showColocation = $derived(!!featureFlags.colocation);
	const showVolumes = $derived(!!featureFlags.volumes);
	const showFirewall = $derived(!!featureFlags.firewall);
	const showImages = $derived(!!featureFlags.images);
</script>

<Toaster position="top-center" />

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>Stack / Dashboard</title>
</svelte:head>

{#if !data.user}
	{@render children()}
{:else}
	<div class="flex h-screen flex-col overflow-hidden bg-gray-900">
		<!-- Top bar -->
		<header class="flex h-12 shrink-0 items-center justify-between border-b border-gray-800 px-4">
			<div class="flex min-w-0 items-center gap-2">
				{#if navItems.length > 0}
					<button
						class="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center text-gray-400 hover:text-gray-100 lg:hidden"
						aria-label="Open navigation menu"
						onclick={() => (mobileNavOpen = true)}
					>
						<Menu class="h-4 w-4" />
					</button>
				{/if}
				<a href={resolve('/')} class="flex shrink-0 items-center gap-2">
					<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
					<span class="text-sm font-semibold tracking-tight text-gray-50">Stack</span>
				</a>
				{#if isOnProjectRoute}
					<span class="text-sm text-gray-500">/</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800 hover:text-gray-50"
						>
							<span class="truncate">{currentProject?.projectName ?? 'Select Project'}</span>
							<ChevronDown class="h-3 w-3 shrink-0 text-gray-500" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start" class="w-52 border-gray-800 bg-gray-900">
							<DropdownMenu.Label class="text-[10px] tracking-wider text-gray-500 uppercase"
								>Projects</DropdownMenu.Label
							>
							{#each projects as project (project.id)}
								<DropdownMenu.Item class="gap-2" onclick={() => selectProject(project.id)}>
									<FolderOpen
										class="h-3.5 w-3.5 {selectedProjectId === project.id
											? 'text-red-500'
											: 'text-gray-500'}"
									/>
									<span class={selectedProjectId === project.id ? 'text-gray-50' : ''}
										>{project.projectName}</span
									>
									{#if selectedProjectId === project.id}
										<Check class="ml-auto h-3 w-3 text-red-500" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					{#if currentProjectSection}
						<span class="text-sm text-gray-500">/</span>
						<p class="text-sm font-medium text-gray-400">{currentProjectSection}</p>
					{/if}
				{/if}
			</div>

			<div class="flex min-w-0 flex-1 items-center justify-end gap-3">
				{#if data.isAdmin}
					<a
						href={resolve('/admin')}
						class="flex h-8 items-center gap-1.5 border border-gray-800 bg-gray-800/30 px-2.5 text-xs font-medium text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-100"
					>
						<Settings class="h-3.5 w-3.5" />
						Admin
					</a>
				{/if}

				<!-- Search trigger -->
				<button
					class="flex shrink-0 items-center gap-2 border border-gray-800 bg-gray-800/30 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-400"
					aria-label="Search"
					onclick={openCommandPalette}
				>
					<Search class="h-3 w-3" />
					<span class="hidden sm:inline">Search...</span>
					<kbd
						class="ml-2 hidden border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 sm:inline-block"
						>⌘K</kbd
					>
				</button>

				<!-- Avatar button — opens user settings -->
				<button
					class="flex min-w-0 items-center gap-2.5 rounded-xs px-2 py-1 transition-colors hover:bg-gray-800"
					aria-label={`Account settings for ${profileName || data.user?.email}`}
					aria-haspopup="dialog"
					onclick={() => openUserSettings()}
				>
					<div class="hidden min-w-0 text-right sm:block">
						<p class="truncate text-sm leading-tight font-medium text-gray-100">{profileName}</p>
						<p class="truncate text-xs leading-tight text-gray-500">{data.user?.email}</p>
					</div>
					<Avatar.Root class="h-8 w-8 shrink-0 rounded-xs border border-gray-700">
						<Avatar.Fallback class="rounded-xs bg-gray-800 text-xs text-gray-400"
							>{(data.user?.name ?? '??')
								.split(' ')
								.map((n: string) => n[0])
								.join('')
								.slice(0, 2)
								.toUpperCase()}</Avatar.Fallback
						>
					</Avatar.Root>
				</button>
			</div>
		</header>

		<!-- Body -->
		{#if isRootPage || isAdminPage}
			<div class="flex flex-1 overflow-hidden">
				{@render children()}
			</div>
		{:else}
			<div class="flex flex-1 overflow-hidden">
				<!-- Icon sidebar -->
				<aside
					class="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-800 py-3 lg:flex"
				>
					{#each navItems as item (item.label)}
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<a
										{...props}
										href={resolve(withProjectContext(item.href) as any)}
										aria-label={item.label}
										aria-current={isActive(item.href) ? 'page' : undefined}
										class="flex h-8 w-8 items-center justify-center transition-colors duration-100 {isActive(
											item.href
										)
											? 'border border-red-500 text-gray-50'
											: 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-200'}"
									>
										<item.icon class="h-4 w-4" />
									</a>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">
								<p>{item.label}</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{/each}
				</aside>

				<!-- Page content -->
				<div class="flex flex-1 overflow-hidden">
					{@render children()}
				</div>
			</div>
		{/if}
	</div>

	<!-- Mobile navigation drawer -->
	<Sheet.Root bind:open={mobileNavOpen}>
		<Sheet.Content side="left" class="w-64 border-gray-800 bg-gray-900 p-0">
			<Sheet.Header class="border-b border-gray-800 px-4 py-3 text-left">
				<Sheet.Title class="text-sm text-gray-100"
					>{currentProject?.projectName ?? 'Menu'}</Sheet.Title
				>
			</Sheet.Header>
			<nav class="flex flex-col p-2">
				{#each navItems as item (item.label)}
					<a
						href={resolve(withProjectContext(item.href) as any)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						onclick={() => (mobileNavOpen = false)}
						class="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors {isActive(
							item.href
						)
							? 'bg-gray-800 text-gray-50'
							: 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}"
					>
						<item.icon class="h-4 w-4 shrink-0" />
						{item.label}
					</a>
				{/each}
			</nav>
		</Sheet.Content>
	</Sheet.Root>

	<UserSettingsDialog
		bind:open={userSettings.open}
		bind:activeTab={userSettings.tab}
		bind:profileName
		user={data.user}
	/>

	<!-- Command Palette -->
	<Command.Dialog
		bind:open={commandOpen}
		class="top-1/2! max-w-xl! -translate-y-1/2! border-gray-800 bg-gray-900"
	>
		<Command.Input
			bind:value={commandSearch}
			placeholder="Search resources, actions..."
			class="border-b border-gray-800"
		/>
		<!-- Filter buttons -->
		<div class="flex gap-1 border-b border-gray-800 px-3 py-2">
			{#each cmdFilters as f (f.id)}
				<button
					class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors {cmdFilter ===
					f.id
						? 'bg-gray-800 text-gray-100'
						: 'text-gray-500 hover:text-gray-300'}"
					onclick={() => (cmdFilter = f.id)}
				>
					<f.icon class="h-3 w-3" />
					{f.label}
				</button>
			{/each}
		</div>
		<Command.List class="max-h-[350px] bg-gray-900">
			<Command.Empty>No results found.</Command.Empty>

			{#if showServersGroup}
				<Command.Group heading="Servers">
					{#if commandServersLoading}
						<Command.Item value={commandSearch || 'Loading servers'} disabled class="gap-2">
							<Server class="h-3.5 w-3.5 text-gray-500" />
							<span>Loading servers...</span>
						</Command.Item>
					{/if}
					{#each filteredCommandServers as server (server.id)}
						<Command.Item
							value={`${server.name} ${server.plan} ${server.status} ${server.detail}`}
							onSelect={() =>
								runCommand(() =>
									goto(resolve(`/projects/${selectedProjectId}/servers/${server.id}` as any))
								)}
							class="gap-2"
						>
							<Server class="h-3.5 w-3.5 text-gray-500" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-gray-100">{server.name}</p>
								<p class="truncate text-xs text-gray-500">{server.plan} · {server.detail}</p>
							</div>
							<span class="ml-auto shrink-0 text-xs text-gray-500">{server.status}</span>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-gray-800" />
			{/if}

			{#if showNavigateGroup}
				<Command.Group heading="Navigate">
					{#each filteredNavigateCommands as command (command.label)}
						<Command.Item
							onSelect={() =>
								runCommand(() => goto(resolve(withProjectContext(command.href ?? '/') as any)))}
							class="gap-2"
						>
							<command.icon class="h-3.5 w-3.5 text-gray-500" />
							<span>{command.label}</span>
							<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-gray-800" />
			{/if}

			{#if showAccountGroup}
				<Command.Group heading="Account">
					{#each filteredAccountCommands as command (command.label)}
						<Command.Item
							onSelect={() => runCommand(command.action ?? (() => openUserSettings()))}
							class="gap-2"
						>
							<command.icon class="h-3.5 w-3.5 text-gray-500" />
							<span>{command.label}</span>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-gray-800" />
			{/if}
		</Command.List>
	</Command.Dialog>
{/if}
