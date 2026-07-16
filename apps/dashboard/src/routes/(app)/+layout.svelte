<script lang="ts">
	import { page } from '$app/state';
	import UserSettingsDialog from '$lib/components/dialogs/user-settings-dialog.svelte';
	import ConfirmDialog from '$lib/components/confirm-dialog.svelte';
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
	import { getErrorMessage, runQuery } from '$lib/utils';
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
		Menu,
		Loader2
	} from '@lucide/svelte';

	let { children, data } = $props();
	let mobileNavOpen = $state(false);
	const featureFlags = $derived((data.featureFlags ?? {}) as FeatureFlags);

	type ProjectRole = 'owner' | 'admin' | 'read_write' | 'read';
	type Project = { id: string; projectName: string; role: ProjectRole };
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state('');
	let switchingProjectId = $state<string | null>(null);
	let projectMenuOpen = $state(false);
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
		if (isOnProjectRoute) {
			const match = page.url.pathname.match(/^\/projects\/([^/]+)/);
			if (match) {
				selectedProjectId = match[1];
			}
		}
	});

	async function selectProject(projectId: string) {
		if (!projectId || projectId === selectedProjectId || switchingProjectId) return;
		switchingProjectId = projectId;
		try {
			selectedProjectId = projectId;
			await authClient.organization.setActive({ organizationId: projectId });
			await goto(resolve(`/projects/${projectId}/servers`));
		} catch (error) {
			toast.error(getErrorMessage(error, 'Failed to switch project'));
		} finally {
			switchingProjectId = null;
			projectMenuOpen = false;
		}
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
		const url = page.url;
		if (!userSettings.urlHasSettingsTab(url)) return;
		userSettings.syncFromUrl(url);
		untrack(() => replaceState(resolve(clearUserSettingsHref(url) as any), page.state));
	});

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
		if (status === 'deleting') return 'Deleting';
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
			const vms = await runQuery(listVms({ projectId }));
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
		void loadCommandServers();
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
	<div class="flex h-screen flex-col overflow-hidden bg-background">
		<header class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="flex min-w-0 items-center gap-2">
				{#if navItems.length > 0}
					<button
						class="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground lg:hidden"
						aria-label="Open navigation menu"
						onclick={() => (mobileNavOpen = true)}
					>
						<Menu class="h-4 w-4" />
					</button>
				{/if}
				<a href={resolve('/')} class="flex shrink-0 items-center gap-2">
					<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
					<span class="text-sm font-semibold tracking-tight text-foreground">Stack</span>
				</a>
				{#if isOnProjectRoute}
					<span class="text-sm text-muted-foreground">/</span>
					<DropdownMenu.Root bind:open={projectMenuOpen}>
						<DropdownMenu.Trigger
							class="flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<span class="truncate">{currentProject?.projectName ?? 'Select Project'}</span>
							<ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="start" class="w-52 border-border bg-background">
							<DropdownMenu.Label class="text-[10px] tracking-wider text-muted-foreground uppercase"
								>Projects</DropdownMenu.Label
							>
							{#each projects as project (project.id)}
								<DropdownMenu.Item
									class="gap-2"
									closeOnSelect={false}
									disabled={switchingProjectId !== null}
									onclick={() => selectProject(project.id)}
								>
									<FolderOpen
										class="h-3.5 w-3.5 {selectedProjectId === project.id
											? 'text-red-500'
											: 'text-muted-foreground'}"
									/>
									<span class={selectedProjectId === project.id ? 'text-foreground' : ''}
										>{project.projectName}</span
									>
									{#if switchingProjectId === project.id}
										<Loader2 class="ml-auto h-3 w-3 animate-spin text-red-500" />
									{:else if selectedProjectId === project.id}
										<Check class="ml-auto h-3 w-3 text-red-500" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					{#if currentProjectSection}
						<span class="hidden text-sm text-muted-foreground lg:inline">/</span>
						<p class="hidden text-sm font-medium text-muted-foreground lg:block">
							{currentProjectSection}
						</p>
					{/if}
				{/if}
			</div>

			<div class="flex min-w-0 flex-1 items-center justify-end gap-3">
				{#if data.isAdmin}
					<a
						href={resolve('/admin')}
						aria-label="Admin"
						class="flex h-8 shrink-0 items-center gap-1.5 border border-border bg-muted/30 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
					>
						<Settings class="h-3.5 w-3.5" />
						<span class="hidden sm:inline">Admin</span>
					</a>
				{/if}

				<button
					class="flex shrink-0 items-center gap-2 border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
					aria-label="Search"
					onclick={openCommandPalette}
				>
					<Search class="h-3 w-3" />
					<span class="hidden sm:inline">Search...</span>
					<kbd
						class="ml-2 hidden border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block"
						>⌘K</kbd
					>
				</button>

				<button
					class="flex min-w-0 items-center gap-2.5 rounded-xs px-2 py-1 transition-colors hover:bg-muted"
					aria-label={`Account settings for ${profileName || data.user?.email}`}
					aria-haspopup="dialog"
					onclick={() => openUserSettings()}
				>
					<div class="hidden min-w-0 text-right sm:block">
						<p class="truncate text-sm leading-tight font-medium text-foreground">{profileName}</p>
						<p class="truncate text-xs leading-tight text-muted-foreground">{data.user?.email}</p>
					</div>
					<Avatar.Root class="h-8 w-8 shrink-0 border border-border">
						<Avatar.Fallback class="bg-muted text-xs text-muted-foreground"
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

		{#if isRootPage || isAdminPage}
			<div class="flex flex-1 overflow-hidden">
				{@render children()}
			</div>
		{:else}
			<div class="flex flex-1 overflow-hidden">
				<aside
					class="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-3 lg:flex"
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
											? 'border border-red-500 text-foreground'
											: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
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

				<div class="flex flex-1 overflow-hidden">
					{@render children()}
				</div>
			</div>
		{/if}
	</div>

	<Sheet.Root bind:open={mobileNavOpen}>
		<Sheet.Content side="left" class="flex w-64 flex-col gap-0 border-border bg-background p-0">
			<Sheet.Header class="border-b border-border px-4 py-3 text-left">
				<Sheet.Title class="truncate text-sm text-foreground"
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
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
					>
						<item.icon class="h-4 w-4 shrink-0" />
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="mt-auto">
				{#if projects.length > 1}
					<div class="border-t border-border p-2">
						<p
							class="px-3 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase"
						>
							Projects
						</p>
						{#each projects as project (project.id)}
							<button
								onclick={() => {
									mobileNavOpen = false;
									selectProject(project.id);
								}}
								class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors {selectedProjectId ===
								project.id
									? 'text-foreground'
									: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
							>
								<FolderOpen
									class="h-4 w-4 shrink-0 {selectedProjectId === project.id
										? 'text-red-500'
										: 'text-muted-foreground'}"
								/>
								<span class="truncate">{project.projectName}</span>
								{#if selectedProjectId === project.id}
									<Check class="ml-auto h-3.5 w-3.5 shrink-0 text-red-500" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}

				{#if data.isAdmin}
					<a
						href={resolve('/admin')}
						onclick={() => (mobileNavOpen = false)}
						class="flex items-center gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
					>
						<Settings class="h-4 w-4 shrink-0" />
						Admin
					</a>
				{/if}
			</div>
		</Sheet.Content>
	</Sheet.Root>

	<UserSettingsDialog
		bind:open={userSettings.open}
		bind:activeTab={userSettings.tab}
		bind:profileName
		user={data.user}
	/>

	<ConfirmDialog />

	<Command.Dialog
		bind:open={commandOpen}
		class="top-1/2! max-w-xl! -translate-y-1/2! border-border bg-background"
	>
		<Command.Input
			bind:value={commandSearch}
			placeholder="Search resources, actions..."
			class="border-b border-border"
		/>
		<div class="flex gap-1 border-b border-border px-3 py-2">
			{#each cmdFilters as f (f.id)}
				<button
					class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors {cmdFilter ===
					f.id
						? 'bg-muted text-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => (cmdFilter = f.id)}
				>
					<f.icon class="h-3 w-3" />
					{f.label}
				</button>
			{/each}
		</div>
		<Command.List class="max-h-[350px] bg-background">
			<Command.Empty>No results found.</Command.Empty>

			{#if showServersGroup}
				<Command.Group heading="Servers">
					{#if commandServersLoading}
						<Command.Item value={commandSearch || 'Loading servers'} disabled class="gap-2">
							<Server class="h-3.5 w-3.5 text-muted-foreground" />
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
							<Server class="h-3.5 w-3.5 text-muted-foreground" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm text-foreground">{server.name}</p>
								<p class="truncate text-xs text-muted-foreground">
									{server.plan} · {server.detail}
								</p>
							</div>
							<span class="ml-auto shrink-0 text-xs text-muted-foreground">{server.status}</span>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-muted" />
			{/if}

			{#if showNavigateGroup}
				<Command.Group heading="Navigate">
					{#each filteredNavigateCommands as command (command.label)}
						<Command.Item
							onSelect={() =>
								runCommand(() => goto(resolve(withProjectContext(command.href ?? '/') as any)))}
							class="gap-2"
						>
							<command.icon class="h-3.5 w-3.5 text-muted-foreground" />
							<span>{command.label}</span>
							<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-muted" />
			{/if}

			{#if showAccountGroup}
				<Command.Group heading="Account">
					{#each filteredAccountCommands as command (command.label)}
						<Command.Item
							onSelect={() => runCommand(command.action ?? (() => openUserSettings()))}
							class="gap-2"
						>
							<command.icon class="h-3.5 w-3.5 text-muted-foreground" />
							<span>{command.label}</span>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-muted" />
			{/if}
		</Command.List>
	</Command.Dialog>
{/if}
