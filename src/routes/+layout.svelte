<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Command from '$lib/components/ui/command';
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { rpc } from '$lib/rpc';
	import { authClient } from '$lib/auth-client';
	import { deleteSshKey } from '$lib/remote/ssh-keys.remote';
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

	// Projects — from server
	type Project = { id: string; projectName: string; role: string };
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state('');

	$effect(() => {
		const incoming = data.projects ?? [];
		untrack(() => {
			projects = incoming;
			if (!selectedProjectId && incoming.length) selectedProjectId = incoming[0].id;
		});
	});
	let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? projects[0]);

	let createProjectOpen = $state(false);
	let newProjectName = $state('');

	async function createProject() {
		if (!newProjectName.trim()) return;
		const res = await rpc<{ id: string }>('projects.create', { name: newProjectName.trim() });
		projects.push({ id: res.id, projectName: newProjectName.trim(), role: 'owner' });
		selectedProjectId = res.id;
		newProjectName = '';
		createProjectOpen = false;
	}

	// Project Sheet
	type ProjectMember = { userId: string; permissions: string };
	type ProjectInfo = {
		id: string;
		projectName: string;
		ownerUserId: string;
		members: ProjectMember[];
	};
	let projectSheetOpen = $state(false);
	let projectSheetLoading = $state(false);
	let projectSheetName = $state('');
	let projectSheetOwnerId = $state('');
	let projectSheetMembers = $state<ProjectMember[]>([]);
	let projectSheetSaving = $state(false);
	let projectSheetSaved = $state(false);
	let projectDeleteConfirm = $state('');
	let projectDeleting = $state(false);

	async function openProjectSheet() {
		if (!selectedProjectId) return;
		projectSheetLoading = true;
		projectSheetOpen = true;
		try {
			const proj = await rpc<ProjectInfo>('projects.get', { projectId: selectedProjectId });
			projectSheetName = proj.projectName;
			projectSheetOwnerId = proj.ownerUserId;
			projectSheetMembers = proj.members;
		} catch (e) {
			console.error('Failed to load project:', e);
			projectSheetOpen = false;
		} finally {
			projectSheetLoading = false;
		}
	}

	async function saveProjectName() {
		if (projectSheetSaving || !selectedProjectId) return;
		const originalName = selectedProject?.projectName;
		projectSheetSaving = true;
		projectSheetSaved = false;
		try {
			await rpc('projects.update', {
				projectId: selectedProjectId,
				name: projectSheetName.trim() || originalName
			});
			const idx = projects.findIndex((p) => p.id === selectedProjectId);
			if (idx !== -1) {
				projects[idx] = { ...projects[idx], projectName: projectSheetName.trim() || originalName };
			}
			projectSheetSaved = true;
			setTimeout(() => (projectSheetSaved = false), 1500);
		} catch (e) {
			console.error('Failed to update project:', e);
			projectSheetName = originalName;
		} finally {
			projectSheetSaving = false;
		}
	}

	async function deleteProjectConfirm() {
		if (projectDeleting || !selectedProjectId) return;
		if (projectDeleteConfirm.trim() !== selectedProject?.projectName) return;
		projectDeleting = true;
		try {
			await rpc('projects.delete', { projectId: selectedProjectId });
			projects = projects.filter((p) => p.id !== selectedProjectId);
			selectedProjectId = projects[0]?.id ?? '';
			projectSheetOpen = false;
			projectDeleteConfirm = '';
		} catch (e) {
			console.error('Failed to delete project:', e);
		} finally {
			projectDeleting = false;
		}
	}

	const navItems = [
		{ icon: Server, label: 'Servers', href: '/' },
		{ icon: Warehouse, label: 'Colocation', href: '/colocation' },
		{ icon: HardDrive, label: 'Volumes', href: '/volumes' },
		{ icon: Shield, label: 'Firewall', href: '/firewall' },
		{ icon: Disc, label: 'Images', href: '/images' },
		{ icon: Settings, label: 'Admin', href: '/admin' }
	];

	function isActive(href: string) {
		if (href === '/') return page.url.pathname === '/';
		return page.url.pathname.startsWith(href);
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
			await invalidateAll();
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

	// SSH Keys — from server
	let sshKeys = $state<{ id: string; name: string; fingerprint: string }[]>([]);

	$effect(() => {
		const keys = data.sshKeys;
		untrack(() => {
			sshKeys = keys ?? [];
		});
	});
	let newKeyName = $state('');
	let newKeyValue = $state('');

	async function addSshKey() {
		if (!newKeyName.trim() || !newKeyValue.trim()) return;
		const res = await rpc<{ id: string; fingerprint: string }>('sshKeys.create', {
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
			const result = await rpc<ApiTokenState[]>('apiTokens.list');
			tokens = result.map((t) => ({
				id: t.id,
				name: t.name,
				created: new Date(t.created).toISOString().slice(0, 10),
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
			const result = await rpc<{ id: string; token: string }>('apiTokens.create', { name });
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
			await rpc('apiTokens.revoke', { tokenId: id });
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
		await loadTokens();
		userSheetOpen = true;
	}

	// Billing
	// (no extra state needed — shown in user sheet)

	// Command palette
	let commandOpen = $state(false);
	type CmdFilter = 'all' | 'servers' | 'colo' | 'navigate' | 'account';
	let cmdFilter = $state<CmdFilter>('all');

	const cmdFilters: { id: CmdFilter; label: string; icon: typeof Server }[] = [
		{ id: 'all', label: 'All', icon: Search },
		{ id: 'servers', label: 'Servers', icon: Server },
		{ id: 'colo', label: 'Colo', icon: Warehouse },
		{ id: 'navigate', label: 'Pages', icon: ArrowRight },
		{ id: 'account', label: 'Account', icon: User }
	];

	function handleKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			cmdFilter = 'all';
			commandOpen = !commandOpen;
		}
		if (commandOpen && e.key === 'Tab') {
			e.preventDefault();
			const ids = cmdFilters.map((f) => f.id);
			const idx = ids.indexOf(cmdFilter);
			cmdFilter = ids[(idx + (e.shiftKey ? ids.length - 1 : 1)) % ids.length];
		}
	}

	function runCommand(fn: () => void) {
		commandOpen = false;
		fn();
	}

	// Searchable resources
	const cmdServers = [
		{ id: 'vps-747762', label: 'vps-747762', detail: '2 vCPU · 2GB · running' },
		{ id: 'vps-742736', label: 'vps-742736', detail: '4 vCPU · 8GB · running' },
		{ id: 'vps-711980', label: 'vps-711980', detail: '2 vCPU · 2GB · stopped' }
	];

	const cmdColo = [
		{ id: 'colo-001', label: 'db-primary', detail: '1U · Rack A12' },
		{ id: 'colo-002', label: 'storage-node', detail: '2U · Rack A12' },
		{ id: 'colo-003', label: 'gpu-worker', detail: '4U · Rack B03' }
	];
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Stack / Dashboard</title>
</svelte:head>

{#if !data.user}
	{@render children()}
{:else}
	<div class="flex h-screen flex-col overflow-hidden bg-fyra-gray-900">
		<!-- Top bar -->
		<header
			class="flex h-12 shrink-0 items-center justify-between border-b border-fyra-gray-800 px-4"
		>
			<div class="flex items-center gap-2">
				<a href="/" class="flex items-center gap-2">
					<svg
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						aria-hidden="true"
					>
						<rect x="3" y="4" width="18" height="4" rx="0.5" fill="#c6716d" />
						<rect x="3" y="10" width="18" height="4" rx="0.5" fill="#c6716d" opacity="0.75" />
						<rect x="3" y="16" width="18" height="4" rx="0.5" fill="#c6716d" opacity="0.5" />
					</svg>
					<span class="text-sm font-semibold tracking-tight text-fyra-gray-50">Stack</span>
				</a>
				<span class="text-sm text-fyra-gray-600">/</span>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex items-center gap-1 px-1.5 py-0.5 text-sm font-medium text-fyra-gray-200 transition-colors hover:bg-fyra-gray-800 hover:text-fyra-gray-50"
					>
						{selectedProject?.projectName ?? 'Select Project'}
						<ChevronDown class="h-3 w-3 text-fyra-gray-500" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-52 border-fyra-gray-800 bg-fyra-gray-900">
						<DropdownMenu.Label class="text-[10px] tracking-wider text-fyra-gray-500 uppercase"
							>Projects</DropdownMenu.Label
						>
						{#each projects as project (project.id)}
							<DropdownMenu.Item class="gap-2" onclick={() => (selectedProjectId = project.id)}>
								<FolderOpen
									class="h-3.5 w-3.5 {selectedProjectId === project.id
										? 'text-fyra-red-500'
										: 'text-fyra-gray-500'}"
								/>
								<span class={selectedProjectId === project.id ? 'text-fyra-gray-50' : ''}
									>{project.projectName}</span
								>
								{#if selectedProjectId === project.id}
									<Check class="ml-auto h-3 w-3 text-fyra-red-500" />
								{/if}
							</DropdownMenu.Item>
						{/each}
						<DropdownMenu.Separator class="bg-fyra-gray-800" />
						<DropdownMenu.Item class="gap-2" onclick={() => (createProjectOpen = true)}>
							<Plus class="h-3.5 w-3.5" />
							Create Project
						</DropdownMenu.Item>
						<DropdownMenu.Item class="gap-2" onclick={() => openProjectSheet()}>
							<Settings class="h-3.5 w-3.5" />
							Settings
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>

			<div class="flex flex-1 items-center justify-end gap-3">
				<!-- Search trigger -->
				<button
					class="flex items-center gap-2 border border-fyra-gray-800 bg-fyra-gray-800/30 px-3 py-1.5 text-xs text-fyra-gray-500 transition-colors hover:border-fyra-gray-700 hover:text-fyra-gray-400"
					onclick={() => (commandOpen = true)}
				>
					<Search class="h-3 w-3" />
					<span>Search...</span>
					<kbd
						class="ml-2 border border-fyra-gray-700 bg-fyra-gray-800 px-1.5 py-0.5 text-[10px] text-fyra-gray-500"
						>⌘K</kbd
					>
				</button>

				<!-- Avatar button — opens user sheet -->
				<button
					class="flex items-center gap-2.5 rounded-xs px-2 py-1 transition-colors hover:bg-fyra-gray-800"
					onclick={() => openUserSheet()}
				>
					<div class="text-right">
						<p class="text-sm leading-tight font-medium text-fyra-gray-100">{profileName}</p>
						<p class="text-xs leading-tight text-fyra-gray-500">{data.user?.email}</p>
					</div>
					<Avatar.Root class="h-8 w-8 rounded-xs border border-fyra-gray-700">
						<Avatar.Fallback class="rounded-xs bg-fyra-gray-800 text-xs text-fyra-gray-400"
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
		<div class="flex flex-1 overflow-hidden">
			<!-- Icon sidebar -->
			<aside
				class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-fyra-gray-800 py-3"
			>
				{#each navItems as item (item.label)}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<a
								href={item.href}
								class="flex h-8 w-8 items-center justify-center transition-colors duration-100 {isActive(
									item.href
								)
									? 'border border-fyra-red-500 text-fyra-gray-50'
									: 'text-fyra-gray-500 hover:bg-fyra-gray-800/50 hover:text-fyra-gray-200'}"
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
	</div>

	<!-- User Sheet -->
	<Sheet.Root bind:open={userSheetOpen}>
		<Sheet.Content
			side="right"
			class="overflow-y-auto border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md"
		>
			<Sheet.Header class="px-6 pt-5 pb-5">
				<div class="flex items-center gap-3 border-l-2 border-fyra-red-500 pl-3">
					<Avatar.Root class="h-9 w-9 rounded-xs border border-fyra-gray-700">
						<Avatar.Fallback
							class="rounded-xs bg-fyra-red-500/10 text-xs font-semibold text-fyra-red-400"
							>{(data.user?.name ?? '??')
								.split(' ')
								.map((n: string) => n[0])
								.join('')
								.slice(0, 2)
								.toUpperCase()}</Avatar.Fallback
						>
					</Avatar.Root>
					<div>
						<Sheet.Title class="text-sm font-medium text-fyra-gray-100">{profileName}</Sheet.Title>
						<Sheet.Description class="text-xs text-fyra-gray-500">{profileEmail}</Sheet.Description>
					</div>
				</div>
			</Sheet.Header>

			<div class="flex flex-col gap-4 px-6 pb-6">
				<!-- Profile -->
				<div class="rounded-xs border border-fyra-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
						<User class="h-3.5 w-3.5 text-fyra-red-400" />
						<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">Profile</p>
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
				<div class="rounded-xs border border-fyra-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
						<Lock class="h-3.5 w-3.5 text-fyra-red-400" />
						<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">
							Password
						</p>
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
									class="absolute top-1/2 right-2 -translate-y-1/2 text-fyra-gray-500 hover:text-fyra-gray-300"
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
								<p class="text-xs text-fyra-red-400">Passwords do not match.</p>
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
				<div class="rounded-xs border border-fyra-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
						<Key class="h-3.5 w-3.5 text-fyra-red-400" />
						<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">
							SSH Keys
						</p>
					</div>

					{#if sshKeys.length > 0}
						<div class="max-h-48 overflow-y-auto">
							<div class="divide-y divide-fyra-gray-800/50">
								{#each sshKeys as key (key.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-fyra-gray-100">{key.name}</p>
											<p class="mt-0.5 truncate font-mono text-[11px] text-fyra-gray-500">
												{key.fingerprint}
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 shrink-0 p-0 text-fyra-red-400 hover:text-fyra-red-300"
											onclick={() => removeSshKey(key.id)}
										>
											<Trash2 class="h-3 w-3" />
										</Button>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="py-2 text-center text-xs text-fyra-gray-500">No SSH keys added.</p>
					{/if}

					<div class="mt-3 flex flex-col gap-2 border-t border-fyra-gray-800/50 pt-3">
						<Input bind:value={newKeyName} placeholder="Key name" class="h-8 text-xs" />
						<textarea
							bind:value={newKeyValue}
							placeholder="ssh-ed25519 AAAA..."
							rows="3"
							class="w-full resize-none border border-fyra-gray-700 bg-fyra-gray-800 px-3 py-2 font-mono text-xs text-fyra-gray-100 placeholder:text-fyra-gray-600 focus:border-fyra-gray-500 focus:outline-none"
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
				<div class="rounded-xs border border-fyra-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
						<KeyRound class="h-3.5 w-3.5 text-fyra-red-400" />
						<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">
							API Tokens
						</p>
					</div>

					{#if generatedToken}
						<div class="mb-3 border border-amber-800/50 bg-amber-950/20 p-3">
							<p class="text-xs font-medium text-amber-400">
								Copy this token now — it won't be shown again.
							</p>
							<div class="mt-2 flex items-center gap-2">
								<code
									class="flex-1 overflow-hidden bg-fyra-gray-800 px-2 py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-fyra-gray-100"
								>
									{generatedToken}
								</code>
								<button
									type="button"
									class="shrink-0 text-fyra-gray-500 hover:text-fyra-gray-300"
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
							<div class="divide-y divide-fyra-gray-800/50">
								{#each tokens as token (token.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-fyra-gray-100">{token.name}</p>
											<p class="mt-0.5 truncate font-mono text-[11px] text-fyra-gray-500">
												sk-stack-****...****
												<span class="ml-2 font-sans text-fyra-gray-600"
													>Created {token.created}</span
												>
											</p>
										</div>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 shrink-0 px-2 text-xs text-fyra-red-400 hover:text-fyra-red-300"
											onclick={() => revokeToken(token.id)}
										>
											Revoke
										</Button>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="py-2 text-center text-xs text-fyra-gray-500">No API tokens.</p>
					{/if}

					<div class="mt-3 flex items-center gap-3 border-t border-fyra-gray-800/50 pt-3">
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

				<!-- Billing -->
				<div class="rounded-xs border border-fyra-gray-800/60 p-4">
					<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
						<CreditCard class="h-3.5 w-3.5 text-fyra-red-400" />
						<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">Billing</p>
					</div>
					<div class="divide-y divide-fyra-gray-800/50">
						<div class="flex items-center justify-between py-2.5 first:pt-0">
							<span class="text-sm text-fyra-gray-400">Current Balance</span>
							<span class="text-sm font-semibold text-fyra-gray-100 tabular-nums">$0.00</span>
						</div>
						<div class="flex items-center justify-between py-2.5">
							<span class="text-sm text-fyra-gray-400">Monthly Estimate</span>
							<span class="text-sm font-medium text-fyra-gray-200 tabular-nums">$26.00</span>
						</div>
						<div class="flex items-center justify-between py-2.5">
							<span class="text-sm text-fyra-gray-400">Payment Method</span>
							<span class="text-sm text-fyra-gray-200">Visa ending 4242</span>
						</div>
						<div class="flex items-center justify-between py-2.5 last:pb-0">
							<span class="text-sm text-fyra-gray-400">Next Invoice</span>
							<span class="text-sm text-fyra-gray-200">May 1, 2026</span>
						</div>
					</div>

					<div class="mt-3 border-t border-fyra-gray-800/50 pt-3">
						<p class="mb-2 text-xs font-semibold tracking-wider text-fyra-gray-500 uppercase">
							Active Resources
						</p>
						<div class="divide-y divide-fyra-gray-800/30">
							{#each [{ name: 'vps-747762', plan: 'STACK-XXS', cost: '$5.00/mo' }, { name: 'vps-742736', plan: 'STACK-SM', cost: '$20.00/mo' }, { name: 'Backups', plan: '2 servers', cost: '$1.00/mo' }] as resource (resource.name)}
								<div class="flex items-center justify-between py-2">
									<span class="text-xs text-fyra-gray-300">{resource.name} ({resource.plan})</span>
									<span class="text-xs text-fyra-gray-400 tabular-nums">{resource.cost}</span>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<!-- Sign Out -->
				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 rounded-xs border border-fyra-red-500/20 bg-fyra-red-500/5 px-4 py-2.5 text-sm font-medium text-fyra-red-400 transition-colors hover:bg-fyra-red-500/10"
					onclick={async () => {
						await authClient.signOut();
						goto('/login');
					}}
				>
					<LogOut class="h-3.5 w-3.5" />
					Sign Out
				</button>
			</div>
		</Sheet.Content>
	</Sheet.Root>

	<!-- Create Project Dialog -->
	<Dialog.Root bind:open={createProjectOpen}>
		<Dialog.Content class="border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Create Project</Dialog.Title>
				<Dialog.Description
					>Projects group your servers, volumes, and other resources.</Dialog.Description
				>
			</Dialog.Header>
			<div class="flex flex-col gap-2 py-4">
				<Label>Project Name</Label>
				<Input bind:value={newProjectName} placeholder="my-project" />
			</div>
			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (createProjectOpen = false)}
					>Cancel</Button
				>
				<Button size="sm" onclick={createProject} disabled={!newProjectName.trim()}>Create</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Project Settings Sheet -->
	<Sheet.Root bind:open={projectSheetOpen}>
		<Sheet.Content
			side="right"
			class="overflow-y-auto border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md"
		>
			<Sheet.Header class="px-6 pt-5 pb-5">
				<Sheet.Title class="text-sm font-medium text-fyra-gray-100">Project Settings</Sheet.Title>
				<Sheet.Description class="text-xs text-fyra-gray-500"
					>Manage your project name and members.</Sheet.Description
				>
			</Sheet.Header>

			{#if projectSheetLoading}
				<div class="flex items-center justify-center py-10">
					<p class="text-sm text-fyra-gray-500">Loading...</p>
				</div>
			{:else}
				<div class="flex flex-col gap-4 px-6 pb-6">
					<!-- Project Name -->
					<div class="rounded-xs border border-fyra-gray-800/60 p-4">
						<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
							<Settings class="h-3.5 w-3.5 text-fyra-red-400" />
							<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">
								Project Name
							</p>
						</div>
						<div class="flex flex-col gap-3">
							<Input bind:value={projectSheetName} class="font-medium" />
							<Button size="sm" onclick={saveProjectName} disabled={projectSheetSaving} class="w-fit">
								{#if projectSheetSaving}
									Saving...
								{:else if projectSheetSaved}
									<Check class="h-3 w-3" /> Saved
								{:else}
									Save Name
								{/if}
							</Button>
						</div>
					</div>

					<!-- Members -->
					<div class="rounded-xs border border-fyra-gray-800/60 p-4">
						<div class="mb-3 flex items-center gap-2 border-b border-fyra-gray-800/50 pb-2">
							<User class="h-3.5 w-3.5 text-fyra-red-400" />
							<p class="text-xs font-semibold tracking-wider text-fyra-gray-400 uppercase">
								Members
							</p>
						</div>
						<div class="max-h-48 overflow-y-auto">
							<!-- Owner -->
							{#if projectSheetOwnerId}
								<div class="flex items-center justify-between py-2.5">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium text-fyra-gray-100">
											{projectSheetOwnerId}
										</p>
										<span
											class="mt-0.5 inline-block rounded-xs bg-fyra-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-fyra-red-400"
											>Owner</span
										>
									</div>
								</div>
								<div class="border-b border-fyra-gray-800/30"></div>
							{/if}
							<!-- Other members -->
							{#if projectSheetMembers.length > 0}
								{#each projectSheetMembers as member (member.userId)}
									<div class="flex items-center justify-between py-2.5">
										<div class="min-w-0">
											<p class="truncate text-sm font-medium text-fyra-gray-100">
												{member.userId}
											</p>
											<span
												class="mt-0.5 inline-block rounded-xs bg-fyra-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-fyra-gray-400"
												>{member.permissions}</span
											>
										</div>
									</div>
								{/each}
							{:else if !projectSheetOwnerId}
								<p class="py-2 text-center text-xs text-fyra-gray-500">No members added.</p>
							{/if}
						</div>
					</div>

					<!-- Delete Project -->
					<div class="rounded-xs border border-fyra-red-900/30 bg-fyra-red-950/10 p-4">
						<div class="mb-3 flex items-center gap-2 border-b border-fyra-red-900/20 pb-2">
							<Trash2 class="h-3.5 w-3.5 text-fyra-red-400" />
							<p class="text-xs font-semibold tracking-wider text-fyra-red-400 uppercase">
								Delete Project
							</p>
						</div>
						<p class="mb-3 text-xs text-fyra-gray-400">
							This will permanently delete the project and all its resources. Type the project
							name to confirm.
						</p>
						<div class="flex flex-col gap-3">
							<Input
								bind:value={projectDeleteConfirm}
								placeholder={selectedProject?.projectName ?? 'project name'}
								class="border-fyra-red-900/50"
							/>
							<Button
								variant="destructive"
								size="sm"
								onclick={deleteProjectConfirm}
								disabled={projectDeleteConfirm.trim() !== selectedProject?.projectName ||
									projectDeleting}
								class="w-fit"
							>
								{#if projectDeleting}
									Deleting...
								{:else}
									Delete Project
								{/if}
							</Button>
						</div>
					</div>
				</div>
			{/if}
		</Sheet.Content>
	</Sheet.Root>

	<!-- Command Palette -->
	<Command.Dialog
		bind:open={commandOpen}
		class="top-1/2! max-w-xl! -translate-y-1/2! border-fyra-gray-800 bg-fyra-gray-900"
	>
		<Command.Input
			placeholder="Search resources, actions..."
			class="border-b border-fyra-gray-800"
		/>
		<!-- Filter buttons -->
		<div class="flex gap-1 border-b border-fyra-gray-800 px-3 py-2">
			{#each cmdFilters as f (f.id)}
				<button
					class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors {cmdFilter ===
					f.id
						? 'bg-fyra-gray-800 text-fyra-gray-100'
						: 'text-fyra-gray-500 hover:text-fyra-gray-300'}"
					onclick={() => (cmdFilter = f.id)}
				>
					<f.icon class="h-3 w-3" />
					{f.label}
				</button>
			{/each}
		</div>
		<Command.List class="max-h-[350px] bg-fyra-gray-900">
			<Command.Empty>No results found.</Command.Empty>

			{#if cmdFilter === 'all' || cmdFilter === 'servers'}
				<Command.Group heading="Servers">
					{#each cmdServers as srv (srv.id)}
						<Command.Item
							onSelect={() => runCommand(() => goto(`/?server=${srv.id}`))}
							class="gap-2"
						>
							<Server class="h-3.5 w-3.5 shrink-0 text-fyra-gray-500" />
							<div class="flex flex-1 items-center justify-between">
								<span>{srv.label}</span><span class="text-[10px] text-fyra-gray-500"
									>{srv.detail}</span
								>
							</div>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-fyra-gray-800" />
			{/if}

			{#if cmdFilter === 'all' || cmdFilter === 'colo'}
				<Command.Group heading="Colocation">
					{#each cmdColo as unit (unit.id)}
						<Command.Item
							onSelect={() => runCommand(() => goto(`/colocation?unit=${unit.id}`))}
							class="gap-2"
						>
							<Warehouse class="h-3.5 w-3.5 shrink-0 text-fyra-gray-500" />
							<div class="flex flex-1 items-center justify-between">
								<span>{unit.label}</span><span class="text-[10px] text-fyra-gray-500"
									>{unit.detail}</span
								>
							</div>
						</Command.Item>
					{/each}
				</Command.Group>
				<Command.Separator class="bg-fyra-gray-800" />
			{/if}

			{#if cmdFilter === 'all' || cmdFilter === 'navigate'}
				<Command.Group heading="Navigate">
					<Command.Item onSelect={() => runCommand(() => goto('/'))} class="gap-2">
						<Server class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Servers</span>
						<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => goto('/colocation'))} class="gap-2">
						<Warehouse class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Colocation</span>
						<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => goto('/volumes'))} class="gap-2">
						<HardDrive class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Volumes</span>
						<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => goto('/firewall'))} class="gap-2">
						<Shield class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Firewall</span>
						<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => goto('/images'))} class="gap-2">
						<Disc class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Images</span>
						<Command.Shortcut><ArrowRight class="h-3 w-3" /></Command.Shortcut>
					</Command.Item>
				</Command.Group>
				<Command.Separator class="bg-fyra-gray-800" />
			{/if}

			{#if cmdFilter === 'all' || cmdFilter === 'account'}
				<Command.Group heading="Account">
					<Command.Item onSelect={() => runCommand(() => openUserSheet())} class="gap-2">
						<User class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Profile</span>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => openUserSheet())} class="gap-2">
						<Key class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>SSH Keys</span>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => openUserSheet())} class="gap-2">
						<KeyRound class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>API Tokens</span>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => openUserSheet())} class="gap-2">
						<CreditCard class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Billing</span>
					</Command.Item>
					<Command.Item onSelect={() => runCommand(() => openUserSheet())} class="gap-2">
						<KeyRound class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Change Password</span>
					</Command.Item>
				</Command.Group>
				<Command.Separator class="bg-fyra-gray-800" />
			{/if}

			{#if cmdFilter === 'all'}
				<Command.Group heading="Quick Actions">
					<Command.Item onSelect={() => runCommand(() => (createProjectOpen = true))} class="gap-2">
						<Plus class="h-3.5 w-3.5 text-fyra-gray-500" />
						<span>Create Project</span>
					</Command.Item>
				</Command.Group>
			{/if}
		</Command.List>
	</Command.Dialog>
{/if}
