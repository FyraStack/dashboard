<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Command from '$lib/components/ui/command';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import {
		createSshKey as createSshKeyRpc,
		deleteSshKey,
		listSshKeys
	} from '$lib/remote/ssh-keys.remote';
	import { listApiTokens, createApiToken, revokeApiToken } from '$lib/remote/api-tokens.remote';
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
		Lock,
		LogOut,
		Check,
		Copy,
		Plus,
		Trash2,
		Eye,
		EyeOff,
		ChevronDown,
		FolderOpen
	} from '@lucide/svelte';

	let { children, data } = $props();
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

	// User sheet
	let userSheetOpen = $state(false);
	let profileName = $state('');
	let profileEmail = $state('');
	let profileSaving = $state(false);
	let profileSaved = $state(false);

	$effect(() => {
		const user = data.user;
		untrack(() => {
			if (user) {
				profileName = user.name ?? '';
				profileEmail = user.email ?? '';
			}
		});
	});

	async function saveProfile() {
		if (profileSaving) return;
		profileSaving = true;
		profileSaved = false;

		const originalName = data.user?.name ?? '';

		profileName = profileName.trim() || originalName;

		try {
			await authClient.updateUser({
				name: profileName
			});
			profileSaved = true;
			setTimeout(() => (profileSaved = false), 1500);
		} catch (error) {
			console.error('Failed to update profile:', error);
			profileName = originalName;
		} finally {
			profileSaving = false;
		}
	}

	// Change password
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let passwordSaved = $state(false);

	function savePassword() {
		if (newPassword !== confirmPassword || !currentPassword) return;
		passwordSaved = true;
		setTimeout(() => {
			passwordSaved = false;
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		}, 1200);
	}

	// SSH Keys
	let sshKeys = $state<{ id: string; name: string; fingerprint: string }[]>([]);
	let sshKeysLoaded = $state(false);

	let newKeyName = $state('');
	let newKeyValue = $state('');

	async function loadSshKeys() {
		if (sshKeysLoaded) return;
		sshKeys = await listSshKeys();
		sshKeysLoaded = true;
	}

	async function addSshKey() {
		if (!newKeyName.trim() || !newKeyValue.trim()) return;
		const res = await createSshKeyRpc({
			name: newKeyName.trim(),
			publicKey: newKeyValue.trim()
		});
		sshKeys.push({ id: res.id, name: newKeyName.trim(), fingerprint: res.fingerprint });
		newKeyName = '';
		newKeyValue = '';
	}

	async function removeSshKey(id: string) {
		await deleteSshKey({ keyId: id });
		sshKeys = sshKeys.filter((k) => k.id !== id);
	}

	// API Tokens
	type ApiTokenState = {
		id: string;
		name: string;
		created: string;
		lastUsedAt: number | null;
	};
	let tokens = $state<ApiTokenState[]>([]);
	let tokensLoading = $state(false);
	let newTokenName = $state('');
	let generatedToken = $state('');
	let copiedTokenId = $state<string | null>(null);

	async function loadTokens() {
		if (tokensLoading || tokens.length > 0) return;
		tokensLoading = true;
		try {
			const result = await listApiTokens().run();
			tokens = result.map((t) => ({
				id: t.id,
				name: t.name,
				created: new Date(t.createdAt).toISOString().slice(0, 10),
				lastUsedAt: t.lastUsedAt
			}));
		} catch (e) {
			console.error('Failed to load tokens:', e);
		} finally {
			tokensLoading = false;
		}
	}

	async function generateToken() {
		if (!newTokenName.trim()) return;
		const name = newTokenName.trim();
		const tempId = `temp-${Date.now()}`;
		const now = new Date().toISOString().slice(0, 10);

		tokens.push({
			id: tempId,
			name,
			created: now,
			lastUsedAt: null
		});

		try {
			const result = await createApiToken({ name });
			generatedToken = result.token;
			const idx = tokens.findIndex((t) => t.id === tempId);
			if (idx !== -1) tokens[idx] = { ...tokens[idx], id: result.id };
		} catch (e) {
			console.error('Failed to create token:', e);
			tokens = tokens.filter((t) => t.id !== tempId);
		} finally {
			newTokenName = '';
		}
	}

	async function revokeToken(id: string) {
		const idx = tokens.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const tokenToRemove = tokens[idx];
		tokens = tokens.filter((t) => t.id !== id);

		try {
			await revokeApiToken({ tokenId: id });
		} catch (e) {
			console.error('Failed to revoke token:', e);
			tokens.splice(idx, 0, tokenToRemove);
		}
	}

	function copyToken(tokenId: string, showFullToken: string | null) {
		const text = showFullToken || `sk-stack-****************************`;
		navigator.clipboard.writeText(text);
		copiedTokenId = tokenId;
		setTimeout(() => (copiedTokenId = null), 1500);
	}

	async function openUserSheet() {
		userSheetOpen = true;
		await Promise.all([loadSshKeys(), loadTokens()]);
	}

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
		{ icon: User, label: 'Profile', action: openUserSheet },
		{ icon: Key, label: 'SSH Keys', action: openUserSheet },
		{ icon: KeyRound, label: 'API Tokens', action: openUserSheet },
		{ icon: KeyRound, label: 'Change Password', action: openUserSheet }
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
			console.error('Failed to load command palette servers:', error);
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
			<div class="flex items-center gap-2">
				<a href={resolve('/')} class="flex items-center gap-2">
					<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
					<span class="text-sm font-semibold tracking-tight text-gray-50">Stack</span>
				</a>
				{#if isOnProjectRoute}
					<span class="text-sm text-gray-600">/</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							class="flex items-center gap-1 px-1.5 py-0.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800 hover:text-gray-50"
						>
							{currentProject?.projectName ?? 'Select Project'}
							<ChevronDown class="h-3 w-3 text-gray-500" />
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
						<span class="text-sm text-gray-600">/</span>
						<p class="text-sm font-medium text-gray-400">{currentProjectSection}</p>
					{/if}
				{/if}
			</div>

			<div class="flex flex-1 items-center justify-end gap-3">
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
					class="flex items-center gap-2 border border-gray-800 bg-gray-800/30 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-400"
					onclick={openCommandPalette}
				>
					<Search class="h-3 w-3" />
					<span>Search...</span>
					<kbd
						class="ml-2 border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500"
						>⌘K</kbd
					>
				</button>

				<!-- Avatar button — opens user sheet -->
				<button
					class="flex items-center gap-2.5 rounded-xs px-2 py-1 transition-colors hover:bg-gray-800"
					onclick={() => openUserSheet()}
				>
					<div class="text-right">
						<p class="text-sm leading-tight font-medium text-gray-100">{profileName}</p>
						<p class="text-xs leading-tight text-gray-500">{data.user?.email}</p>
					</div>
					<Avatar.Root class="h-8 w-8 rounded-xs border border-gray-700">
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
				<aside class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-800 py-3">
					{#each navItems as item (item.label)}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<a
									href={resolve(withProjectContext(item.href) as any)}
									class="flex h-8 w-8 items-center justify-center transition-colors duration-100 {isActive(
										item.href
									)
										? 'border border-red-500 text-gray-50'
										: 'text-gray-500 hover:bg-gray-800/50 hover:text-gray-200'}"
								>
									<item.icon class="h-4 w-4" />
								</a>
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

	<!-- User Sheet -->
	<Sheet.Root bind:open={userSheetOpen}>
		<Sheet.Content side="right" class="overflow-y-auto border-gray-800 bg-gray-900 sm:max-w-md">
			<Sheet.Header class="px-6 pt-5 pb-5">
				<div class="flex items-center gap-3 border-l-2 border-red-500 pl-3">
					<Avatar.Root class="h-9 w-9 rounded-xs border border-gray-700">
						<Avatar.Fallback class="rounded-xs bg-red-500/10 text-xs font-semibold text-red-400"
							>{(data.user?.name ?? '??')
								.split(' ')
								.map((n: string) => n[0])
								.join('')
								.slice(0, 2)
								.toUpperCase()}</Avatar.Fallback
						>
					</Avatar.Root>
					<div>
						<Sheet.Title class="text-sm font-medium text-gray-100">{profileName}</Sheet.Title>
						<Sheet.Description class="text-xs text-gray-500">{profileEmail}</Sheet.Description>
					</div>
				</div>
			</Sheet.Header>

			<div class="flex flex-col gap-4 px-6 pb-6">
				<!-- Profile -->
				<div class="rounded-xs border border-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-gray-800/50 pb-2">
						<User class="h-3.5 w-3.5 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Profile</p>
					</div>
					<div class="flex flex-col gap-3">
						<div class="flex flex-col gap-1.5">
							<Label>Full Name</Label>
							<Input bind:value={profileName} />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label>Email Address</Label>
							<Input bind:value={profileEmail} type="email" disabled />
						</div>
						<Button size="sm" onclick={saveProfile} disabled={profileSaving} class="w-fit">
							{#if profileSaving}
								Saving...
							{:else if profileSaved}
								<Check class="h-3 w-3" /> Saved
							{:else}
								Save Profile
							{/if}
						</Button>
					</div>
				</div>

				<!-- Password -->
				<div class="rounded-xs border border-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-gray-800/50 pb-2">
						<Lock class="h-3.5 w-3.5 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Password</p>
					</div>
					<div class="flex flex-col gap-3">
						<div class="flex flex-col gap-1.5">
							<Label>Current Password</Label>
							<div class="relative">
								<Input
									bind:value={currentPassword}
									type={showPassword ? 'text' : 'password'}
									placeholder="********"
								/>
								<button
									type="button"
									class="absolute top-1/2 right-2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
									onclick={() => (showPassword = !showPassword)}
								>
									{#if showPassword}
										<EyeOff class="h-3.5 w-3.5" />
									{:else}
										<Eye class="h-3.5 w-3.5" />
									{/if}
								</button>
							</div>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label>New Password</Label>
							<Input bind:value={newPassword} type="password" placeholder="********" />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label>Confirm New Password</Label>
							<Input bind:value={confirmPassword} type="password" placeholder="********" />
							{#if confirmPassword && newPassword !== confirmPassword}
								<p class="text-xs text-red-400">Passwords do not match.</p>
							{/if}
						</div>
						<Button
							size="sm"
							onclick={savePassword}
							disabled={!currentPassword || !newPassword || newPassword !== confirmPassword}
							class="w-fit"
						>
							{#if passwordSaved}
								<Check class="h-3 w-3" /> Updated
							{:else}
								Update Password
							{/if}
						</Button>
					</div>
				</div>

				<!-- SSH Keys -->
				<div class="rounded-xs border border-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-gray-800/50 pb-2">
						<Key class="h-3.5 w-3.5 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">SSH Keys</p>
					</div>

					{#if sshKeys.length > 0}
						<div class="max-h-48 overflow-y-auto">
							<div class="divide-y divide-gray-800/50">
								{#each sshKeys as key (key.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-gray-100">{key.name}</p>
											<p class="mt-0.5 truncate font-mono text-[11px] text-gray-500">
												{key.fingerprint}
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 shrink-0 p-0 text-red-400 hover:text-red-300"
											onclick={() => removeSshKey(key.id)}
										>
											<Trash2 class="h-3 w-3" />
										</Button>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="py-2 text-center text-xs text-gray-500">No SSH keys added.</p>
					{/if}

					<div class="mt-3 flex flex-col gap-2 border-t border-gray-800/50 pt-3">
						<Input bind:value={newKeyName} placeholder="Key name" class="h-8 text-xs" />
						<textarea
							bind:value={newKeyValue}
							placeholder="ssh-ed25519 AAAA..."
							rows="3"
							class="w-full resize-none border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
						></textarea>
						<Button
							variant="outline"
							size="sm"
							class="w-fit gap-1.5 text-xs"
							onclick={addSshKey}
							disabled={!newKeyName.trim() || !newKeyValue.trim()}
						>
							<Plus class="h-3 w-3" />
							Add Key
						</Button>
					</div>
				</div>

				<!-- API Tokens -->
				<div class="rounded-xs border border-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-gray-800/50 pb-2">
						<KeyRound class="h-3.5 w-3.5 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">API Tokens</p>
					</div>

					{#if generatedToken}
						<div class="mb-3 border border-amber-800/50 bg-amber-950/20 p-3">
							<p class="text-xs font-medium text-amber-400">
								Copy this token now — it won't be shown again.
							</p>
							<div class="mt-2 flex items-center gap-2">
								<code
									class="flex-1 overflow-hidden bg-gray-800 px-2 py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-gray-100"
								>
									{generatedToken}
								</code>
								<button
									type="button"
									class="shrink-0 text-gray-500 hover:text-gray-300"
									onclick={() => copyToken('new-token', generatedToken)}
								>
									{#if copiedTokenId === 'new-token'}
										<Check class="h-3.5 w-3.5 text-emerald-500" />
									{:else}
										<Copy class="h-3.5 w-3.5" />
									{/if}
								</button>
							</div>
						</div>
					{/if}

					{#if tokens.length > 0}
						<div class="max-h-48 overflow-y-auto">
							<div class="divide-y divide-gray-800/50">
								{#each tokens as token (token.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-gray-100">{token.name}</p>
											<p class="mt-0.5 truncate font-mono text-[11px] text-gray-500">
												sk-stack-****...****
												<span class="ml-2 font-sans text-gray-600">Created {token.created}</span>
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 shrink-0 px-2 text-xs text-red-400 hover:text-red-300"
											onclick={() => revokeToken(token.id)}
										>
											Revoke
										</Button>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="py-2 text-center text-xs text-gray-500">No API tokens.</p>
					{/if}

					<div class="mt-3 flex items-center gap-3 border-t border-gray-800/50 pt-3">
						<Input bind:value={newTokenName} placeholder="Token name" class="h-8 text-xs" />
						<Button
							variant="outline"
							size="sm"
							class="shrink-0 gap-1.5 text-xs"
							onclick={generateToken}
							disabled={!newTokenName.trim()}
						>
							<Plus class="h-3 w-3" />
							Generate
						</Button>
					</div>
				</div>

				<!-- Sign Out -->
				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 rounded-xs border border-red-500/20 bg-red-500/5 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
					onclick={async () => {
						await authClient.signOut();
						goto(resolve('/login'));
					}}
				>
					<LogOut class="h-3.5 w-3.5" />
					Sign Out
				</button>
			</div>
		</Sheet.Content>
	</Sheet.Root>

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
									goto(resolve(`/projects/${selectedProjectId}/servers/${server.id}`) as any)
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
							onSelect={() => runCommand(command.action ?? openUserSheet)}
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
