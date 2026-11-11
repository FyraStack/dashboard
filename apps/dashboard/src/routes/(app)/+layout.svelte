<script lang="ts">
	import type { FeatureFlagKey } from 'stack-shared/feature-flags';
	import { tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { IconComponent } from '#lib';
	import { authClient } from '#lib/auth-client.js';
	import UserSettingsDialog from '#lib/components/dialogs/user-settings-dialog.svelte';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Command from '#lib/components/ui/command/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { confirmController } from '#lib/confirm.svelte.js';
	import { dependencies } from '#lib/dependencies.js';
	import { formatLongDate } from '#lib/format.js';
	import { markAnnouncementsRead } from '#lib/remote/announcements.remote.js';
	import { listVms } from '#lib/remote/vms.remote.js';
	import { toServerInfo } from '#lib/server-info.js';
	import {
		clearUserSettingsHref,
		UserSettingsState,
		type UserSettingsTab
	} from '#lib/state/user-settings.svelte.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { describeServerStatus } from '#lib/vm-status.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowRight from '~icons/lucide/arrow-right';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import ExternalLink from '~icons/lucide/external-link';
	import Loader2 from '~icons/lucide/loader-2';
	import Menu from '~icons/lucide/menu';
	import Warehouse from '~icons/nucleo/box';
	import CreditCard from '~icons/nucleo/credit-card';
	import Disc from '~icons/nucleo/disc';
	import FolderOpen from '~icons/nucleo/folder-open';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Key from '~icons/nucleo/key';
	import Megaphone from '~icons/nucleo/megaphone';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import Settings from '~icons/nucleo/settings';
	import Shield from '~icons/nucleo/shield';
	import User from '~icons/nucleo/user';
	import type { LayoutProps } from './$types';

	const PROJECT_PATH_PATTERN = /^\/projects\/([^/]+)/;
	const PROJECT_SECTION_PATTERN = /^\/projects\/[^/]+\/([^/]+)/;

	let { children, data }: LayoutProps = $props();
	let mobileNavOpen = $state(false);

	type Project = LayoutProps['data']['projects'][number];
	let projects = $state<Project[]>([]);
	let selectedProjectId = $state('');
	let switchingProjectId = $state<string | null>(null);
	let projectMenuOpen = $state(false);
	let currentProject = $derived(
		projects.find((project) => project.id === selectedProjectId) ?? data.currentProject
	);

	$effect(() => {
		const incoming = data.projects;
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
		const segment = page.url.pathname.match(PROJECT_SECTION_PATTERN)?.[1];
		if (!segment) {
			return '';
		}
		return segment
			.split('-')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ');
	});

	interface ProjectSection {
		featureFlag?: FeatureFlagKey;
		icon: IconComponent;
		label: string;
		path: string;
	}

	const projectSections: ProjectSection[] = [
		{ icon: Server, label: 'Servers', path: 'servers' },
		{ icon: Warehouse, label: 'Colocation', path: 'colocation', featureFlag: 'colocation' },
		{ icon: HardDrive, label: 'Volumes', path: 'volumes', featureFlag: 'volumes' },
		{ icon: Shield, label: 'Firewall', path: 'firewall', featureFlag: 'firewall' },
		{ icon: Disc, label: 'Images', path: 'images', featureFlag: 'images' },
		{ icon: CreditCard, label: 'Billing', path: 'billing' },
		{ icon: Settings, label: 'Settings', path: 'settings' }
	];

	const visibleProjectSections = $derived(
		projectSections.filter(
			(section) => !section.featureFlag || data.featureFlags[section.featureFlag]
		)
	);

	function projectSectionPathname(
		section: ProjectSection,
		projectId: string
	): `projects/${string}` {
		return `projects/${projectId}/${section.path}`;
	}

	const navItems = $derived(
		currentProject
			? visibleProjectSections.map((section) => ({
					icon: section.icon,
					label: section.label,
					pathname: projectSectionPathname(section, currentProject.id)
				}))
			: []
	);

	const navLinkStyles = {
		rail: {
			base: 'flex h-8 w-8 items-center justify-center transition-colors duration-100',
			active: 'border border-red-500 text-foreground',
			inactive: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
			icon: 'h-4 w-4'
		},
		drawer: {
			base: 'flex items-center gap-3 px-3 py-2.5 text-sm transition-colors',
			active: 'bg-muted text-foreground',
			inactive: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
			icon: 'h-4 w-4 shrink-0'
		}
	};

	function isActive(pathname: string) {
		return page.url.pathname.startsWith(`/${pathname}`);
	}

	$effect(() => {
		if (isOnProjectRoute) {
			const routeProjectId = page.url.pathname.match(PROJECT_PATH_PATTERN)?.[1];
			if (routeProjectId) {
				selectedProjectId = routeProjectId;
			}
		}
	});

	async function selectProject(projectId: string) {
		if (!projectId || projectId === selectedProjectId || switchingProjectId) {
			return;
		}
		switchingProjectId = projectId;
		try {
			selectedProjectId = projectId;
			await authClient.organization.setActive({ organizationId: projectId });
			await goto(resolve(`projects/${projectId}/servers`), {
				invalidate: [dependencies.app.projects]
			});
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
		const { user } = data;
		untrack(() => {
			profileName = user.name ?? '';
		});
	});

	function openUserSettings(tab: UserSettingsTab = 'profile') {
		userSettings.show(tab);
	}

	$effect(() => {
		const { url } = page;
		if (!userSettings.urlHasSettingsTab(url)) {
			return;
		}
		userSettings.syncFromUrl(url);
		untrack(() =>
			goto(clearUserSettingsHref(url), {
				shallow: true,
				replace: true,
				state: page.state
			})
		);
	});

	let commandOpen = $state(false);
	let commandSearch = $state('');
	type CmdFilter = 'all' | 'navigate' | 'servers' | 'account';
	let cmdFilter = $state<CmdFilter>('all');
	interface CommandServer {
		detail: string;
		id: string;
		name: string;
		plan: string;
		status: string;
	}
	interface CommandEntry {
		action: () => void | Promise<void>;
		icon: IconComponent;
		label: string;
	}
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
		const filters: { id: CmdFilter; label: string; icon: IconComponent }[] = [
			{ id: 'all', label: 'All', icon: Search },
			{ id: 'navigate', label: 'Pages', icon: ArrowRight }
		];
		if (showServerFilter) {
			filters.push({ id: 'servers', label: 'Servers', icon: Server });
		}
		filters.push({ id: 'account', label: 'Account', icon: User });
		return filters;
	});

	const navigateCommands = $derived<CommandEntry[]>(
		selectedProjectId
			? visibleProjectSections.map((section) => ({
					icon: section.icon,
					label: section.label,
					action: () => goto(resolve(projectSectionPathname(section, selectedProjectId)))
				}))
			: []
	);
	const accountCommands: CommandEntry[] = [
		{ icon: User, label: 'Profile', action: () => openUserSettings('profile') },
		{ icon: Key, label: 'SSH Keys', action: () => openUserSettings('keys') },
		{ icon: Key, label: 'API Tokens', action: () => openUserSettings('api') },
		{ icon: Key, label: 'Change Password', action: () => openUserSettings('security') }
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
		if (!normalizedCommandSearch) {
			return true;
		}
		return values.some((value) => value?.toLowerCase().includes(normalizedCommandSearch));
	}

	async function loadCommandServers(projectId = selectedProjectId) {
		if (!projectId || commandServersLoading || commandServersLoadedProjectId === projectId) {
			return;
		}
		commandServersRequestId += 1;
		const requestId = commandServersRequestId;
		commandServersLoading = true;

		try {
			const vmsQuery = listVms({ projectId });
			await vmsQuery.refresh();
			const vms = await vmsQuery;
			if (requestId !== commandServersRequestId) {
				return;
			}
			commandServers = vms
				.filter((vm) => vm.active)
				.map((vm) => {
					const info = toServerInfo(vm);
					return {
						id: vm.id,
						name: vm.name,
						plan: vm.vmType?.name ?? 'Custom',
						status: describeServerStatus(info.status, info.liveLoaded).label,
						detail:
							[
								vm.vmType?.cores ? `${vm.vmType.cores} vCPU` : null,
								vm.vmType?.ramCapacity ? `${vm.vmType.ramCapacity}MB RAM` : null,
								vm.vmType?.storageAmount ? `${vm.vmType.storageAmount}GB disk` : null
							]
								.filter(Boolean)
								.join(' • ') || 'Server'
					};
				});
			commandServersLoadedProjectId = projectId;
		} catch (error) {
			if (requestId !== commandServersRequestId) {
				return;
			}
			toast.error(getErrorMessage(error, 'Failed to load servers'));
			commandServers = [];
			commandServersLoadedProjectId = projectId;
		} finally {
			if (requestId === commandServersRequestId) {
				commandServersLoading = false;
			}
		}
	}

	function openCommandPalette() {
		commandSearch = '';
		cmdFilter = 'all';
		commandOpen = true;
		loadCommandServers();
	}

	$effect(() => {
		const projectId = selectedProjectId;
		untrack(() => {
			if (commandServersLoadedProjectId === projectId && !commandServersLoading) {
				return;
			}
			commandServers = [];
			commandServersLoadedProjectId = null;
			commandServersRequestId += 1;
			commandServersLoading = false;
		});
	});

	$effect(() => {
		if (cmdFilter === 'servers' && !showServerFilter) {
			cmdFilter = 'all';
		}
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
		if (confirmController.open && e.key === 'Escape') {
			e.preventDefault();
			decideConfirm(false);
		}
		if (commandOpen && e.key === 'Tab') {
			e.preventDefault();
			const ids = cmdFilters.map((f) => f.id);
			const idx = ids.indexOf(cmdFilter);
			cmdFilter = ids[(idx + (e.shiftKey ? ids.length - 1 : 1)) % ids.length];
		}
	}

	let confirmTyped = $state('');
	const confirmRequest = $derived(confirmController.request);
	const confirmNeedsWord = $derived(Boolean(confirmRequest?.confirmWord));
	const canConfirm = $derived(
		!confirmNeedsWord || confirmTyped.trim() === confirmRequest?.confirmWord
	);

	$effect(() => {
		if (confirmController.open) {
			confirmTyped = '';
			tick().then(() => {
				(
					document.getElementById('confirm-name-input') ?? document.getElementById('confirm-ok-btn')
				)?.focus();
			});
		}
	});

	function decideConfirm(ok: boolean) {
		if (ok && !canConfirm) {
			return;
		}
		confirmController.resolve(ok);
		confirmController.open = false;
	}

	function runCommand(fn: () => void | Promise<void>) {
		commandOpen = false;
		fn();
	}

	const announcements = untrack(() => data.unreadAnnouncements);
	let announcementsOpen = $state(announcements.length > 0);
	let announcementIndex = $state(0);
	const currentAnnouncement = $derived(announcements[announcementIndex]);
	const announcementsMarkedRead = new Set<string>();

	$effect(() => {
		if (!(announcementsOpen && currentAnnouncement)) {
			return;
		}
		const { id } = currentAnnouncement;
		if (announcementsMarkedRead.has(id)) {
			return;
		}
		announcementsMarkedRead.add(id);
		markAnnouncementsRead({ announcementIds: [id] }).catch(() => {
			announcementsMarkedRead.delete(id);
		});
	});

	function showAnnouncement(index: number) {
		announcementIndex = Math.min(Math.max(index, 0), announcements.length - 1);
	}

	function handleAnnouncementKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') {
			showAnnouncement(announcementIndex - 1);
		} else if (event.key === 'ArrowRight') {
			showAnnouncement(announcementIndex + 1);
		}
	}
</script>

<Toaster position="top-center" />
<svelte:window onkeydown={handleKeydown} />
<svelte:head><title>Stack / Dashboard</title></svelte:head>

{#snippet projectEntry(
	project: Project
)}
	<FolderOpen
		class="size-4 shrink-0 {selectedProjectId === project.id
			? 'text-red-500'
			: 'text-muted-foreground'}"
	/>
	<span class="truncate {selectedProjectId === project.id ? 'text-foreground' : ''}"
		>{project.projectName}</span
	>
	{#if switchingProjectId === project.id}
		<Loader2 class="ml-auto h-3 w-3 shrink-0 animate-spin text-red-500" />
	{:else if selectedProjectId === project.id}
		<Check class="ml-auto h-3 w-3 shrink-0 text-red-500" />
	{/if}
{/snippet}

{#snippet adminLink(
	linkClass: string,
	labelClass: string,
	onNavigate?: () => void
)}
	<a href={resolve('admin')} aria-label="Admin" class={linkClass} onclick={onNavigate}>
		<Settings class="size-4 shrink-0" />
		<span class={labelClass}>Admin</span>
	</a>
{/snippet}

{#snippet navLink(
	item: (typeof navItems)[number],
	variant: keyof typeof navLinkStyles,
	props: Record<string, unknown> = {},
	onNavigate?: () => void
)}
	{@const styles = navLinkStyles[variant]}
	{@const active = isActive(item.pathname)}
	<a
		{...props}
		href={resolve(item.pathname)}
		aria-current={active ? 'page' : undefined}
		onclick={onNavigate}
		class="{styles.base} {active ? styles.active : styles.inactive}"
	>
		<item.icon class={styles.icon} />
		<span class={variant === 'rail' ? 'sr-only' : ''}>{item.label}</span>
	</a>
{/snippet}

<div class="flex h-screen flex-col overflow-hidden bg-background">
	<header class="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
		<div class="flex min-w-0 items-center gap-2">
			{#if navItems.length > 0}
				<button
					type="button"
					class="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground lg:hidden"
					aria-label="Open navigation menu"
					onclick={() => (mobileNavOpen = true)}
				>
					<Menu class="h-4 w-4" />
				</button>
			{/if}
			<a href={resolve('')} class="flex shrink-0 items-center gap-2">
				<img src="/logo.svg" alt="" class="h-5 w-5" />
				<span class="text-sm font-semibold tracking-tight text-foreground">Stack</span>
				<Badge class="h-4 px-1.5 text-[10px]" variant="secondary">Alpha</Badge>
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
								{@render projectEntry(project)}
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
				{@render adminLink(
					'flex h-8 shrink-0 items-center gap-1.5 border border-border bg-muted/30 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground',
					'hidden sm:inline'
				)}
			{/if}

			<button
				type="button"
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
				type="button"
				class="flex min-w-0 items-center gap-2.5 rounded-xs px-2 py-1 transition-colors hover:bg-muted"
				aria-label={`Account settings for ${profileName || data.user.email}`}
				aria-haspopup="dialog"
				onclick={() => openUserSettings()}
			>
				<div class="hidden min-w-0 text-right sm:block">
					<p class="truncate text-sm leading-tight font-medium text-foreground">{profileName}</p>
					<p class="truncate text-xs leading-tight text-muted-foreground">{data.user.email}</p>
				</div>
				<Avatar.Root class="h-8 w-8 shrink-0 border border-border">
					<Avatar.Fallback class="bg-muted text-xs text-muted-foreground"
						>{(data.user.name ?? '??')
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
		<main class="flex flex-1 overflow-hidden">
			{@render children()}
		</main>
	{:else}
		<div class="flex flex-1 overflow-hidden">
			<aside
				class="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-3 lg:flex"
			>
				{#each navItems as item (item.label)}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({
								props
							})}
								{@render navLink(item, 'rail', props)}
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">
							<p>{item.label}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				{/each}
			</aside>

			<main class="flex flex-1 overflow-hidden">
				{@render children()}
			</main>
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
				{@render navLink(item, 'drawer', {}, () => (mobileNavOpen = false))}
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
							type="button"
							onclick={() => {
								mobileNavOpen = false;
								selectProject(project.id);
							}}
							class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors {selectedProjectId ===
							project.id
								? 'text-foreground'
								: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
						>
							{@render projectEntry(project)}
						</button>
					{/each}
				</div>
			{/if}

			{#if data.isAdmin}
				{@render adminLink(
					'flex items-center gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
					'',
					() => (mobileNavOpen = false)
				)}
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<UserSettingsDialog
	bind:open={userSettings.open}
	bind:activeTab={userSettings.tab}
	bind:profileName
	user={data.user}
	announcementsEnabled={data.announcementsEnabled}
/>

{#if confirmController.open}
	<!-- z above bits-ui dialogs (z-50) so a confirm opened from another dialog sits on top -->
	<div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Cancel"
			class="absolute inset-0 bg-black/50"
			onclick={() => decideConfirm(false)}
		></button>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			aria-describedby="confirm-desc"
			class="relative z-10 w-full max-w-md border border-border bg-background p-4 text-sm text-foreground ring-1 ring-foreground/10"
		>
			<h2 id="confirm-title" class="text-base font-semibold text-foreground">
				{confirmRequest?.title}
			</h2>
			<p id="confirm-desc" class="mt-1 text-sm text-muted-foreground">
				{confirmRequest?.description}
			</p>
			{#if confirmNeedsWord}
				<div class="mt-4 space-y-1.5">
					<label for="confirm-name-input" class="block text-xs text-muted-foreground">
						Type <span class="font-mono text-foreground">{confirmRequest?.confirmWord}</span> to
						confirm
					</label>
					<Input
						id="confirm-name-input"
						bind:value={confirmTyped}
						autocomplete="off"
						autocapitalize="off"
						spellcheck={false}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								decideConfirm(true);
							}
						}}
					/>
				</div>
			{/if}
			<div class="mt-5 flex justify-end gap-2">
				<Button variant="outline" size="sm" onclick={() => decideConfirm(false)}>Cancel</Button>
				<Button
					id="confirm-ok-btn"
					variant="destructive"
					size="sm"
					disabled={!canConfirm}
					onclick={() => decideConfirm(true)}
				>
					{confirmRequest?.confirmLabel ?? 'Delete'}
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if currentAnnouncement}
	<Dialog.Root bind:open={announcementsOpen}>
		<Dialog.Content
			class="gap-5 border-border bg-background sm:max-w-lg"
			onkeydown={handleAnnouncementKeydown}
		>
			<Dialog.Header class="gap-2">
				<div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<Megaphone class="size-3.5" />
					<span>What's new</span>
					{#if announcements.length > 1}
						<span class="tabular-nums">· {announcementIndex + 1} of {announcements.length}</span>
					{/if}
				</div>
				<Dialog.Title class="pr-6 text-base leading-snug text-balance">
					{currentAnnouncement.title}
				</Dialog.Title>
				<Dialog.Description class="text-xs">
					<time datetime={new Date(currentAnnouncement.publishedAt).toISOString()}>
						{formatLongDate(currentAnnouncement.publishedAt)}
					</time>
				</Dialog.Description>
			</Dialog.Header>
			{#if currentAnnouncement.imageVersion !== null}
				<img
					src="{resolve(
						`announcements/${currentAnnouncement.id}/image`
					)}?v={currentAnnouncement.imageVersion}"
					alt=""
					class="aspect-[2/1] w-full rounded-lg bg-muted object-cover ring-1 ring-foreground/10"
				/>
			{/if}
			<div
				class="max-h-[50vh] overflow-y-auto text-sm leading-relaxed text-pretty whitespace-pre-line text-foreground/90"
			>
				{currentAnnouncement.body}
			</div>
			{#if currentAnnouncement.linkUrl}
				<a
					href={currentAnnouncement.linkUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-red-400 underline-offset-4 hover:underline"
				>
					{currentAnnouncement.linkLabel || 'Learn more'}
					<ExternalLink class="size-3.5" />
				</a>
			{/if}
			<div class="flex items-center justify-between gap-3">
				{#if announcements.length > 1}
					<div class="flex items-center">
						{#each announcements as announcement, index (announcement.id)}
							<button
								type="button"
								class="flex size-5 items-center justify-center"
								aria-label="Show announcement {index + 1}: {announcement.title}"
								aria-current={index === announcementIndex}
								onclick={() => showAnnouncement(index)}
							>
								<span
									class="block h-1.5 rounded-full transition-all {index === announcementIndex
										? 'w-4 bg-foreground'
										: 'w-1.5 bg-muted-foreground/40'}"
								></span>
							</button>
						{/each}
					</div>
				{:else}
					<span></span>
				{/if}
				<div class="flex items-center gap-2">
					{#if announcementIndex > 0}
						<Button
							variant="outline"
							size="sm"
							onclick={() => showAnnouncement(announcementIndex - 1)}
						>
							<ChevronLeft />
							Previous
						</Button>
					{/if}
					{#if announcementIndex < announcements.length - 1}
						<Button size="sm" onclick={() => showAnnouncement(announcementIndex + 1)}>
							Next
							<ChevronRight />
						</Button>
					{:else}
						<Button size="sm" onclick={() => (announcementsOpen = false)}>Done</Button>
					{/if}
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Root>
{/if}

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
				type="button"
				class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors {cmdFilter ===
				f.id
					? 'bg-muted text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (cmdFilter = f.id)}
			>
				<f.icon class="h-3 w-3" />{f.label}
			</button>
		{/each}
	</div>
	<Command.List class="max-h-[350px] bg-background">
		<Command.Empty>No results found.</Command.Empty>

		{#if showServersGroup}
			<Command.Group heading="Servers">
				{#if commandServersLoading}
					<Command.Item value={commandSearch || 'Loading servers'} disabled class="gap-2">
						<Server class="size-4 text-muted-foreground" />
						<span>Loading servers...</span>
					</Command.Item>
				{/if}
				{#each filteredCommandServers as server (server.id)}
					<Command.Item
						value={`${server.name} ${server.plan} ${server.status} ${server.detail}`}
						onSelect={() =>
							runCommand(() => goto(resolve(`projects/${selectedProjectId}/servers/${server.id}`)))}
						class="gap-2"
					>
						<Server class="size-4 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm text-foreground">{server.name}</p>
							<p class="truncate text-xs text-muted-foreground">{server.plan} · {server.detail}</p>
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
					<Command.Item onSelect={() => runCommand(command.action)} class="gap-2">
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
					<Command.Item onSelect={() => runCommand(command.action)} class="gap-2">
						<command.icon class="h-3.5 w-3.5 text-muted-foreground" />
						<span>{command.label}</span>
					</Command.Item>
				{/each}
			</Command.Group>
			<Command.Separator class="bg-muted" />
		{/if}
	</Command.List>
</Command.Dialog>
