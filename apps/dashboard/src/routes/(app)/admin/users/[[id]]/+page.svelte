<script lang="ts">
	import type { VerificationMethod } from 'stack-shared/auth';
	import type { Snippet } from 'svelte';
	import type { IconComponent } from '#lib';
	import { hasAnyTwoFactor } from '#lib/admin-users.js';
	import { describeDeletionVerification } from '#lib/admin-verification.js';
	import FilterMenu from '#lib/components/admin/filter-menu.svelte';
	import { adminMenuItemClass } from '#lib/components/admin/menu-item-class.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import VerificationDialog from '#lib/components/verification-dialog.svelte';
	import { dependencies } from '#lib/dependencies.js';
	import { formatDate, formatDateTime, initials } from '#lib/format.js';
	import { runOptimistic } from '#lib/optimistic.js';
	import {
		type AdminUser,
		beginDeleteUser,
		deleteUserWithVerification,
		getOrganizationResources,
		getUserResources,
		setUserAdmin,
		setUserBillingExempt,
		setUserDisabled,
		setUserTwoFactor,
		type UserOrganization
	} from '#lib/remote/admin-users.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { statusBadgeClass } from '#lib/vm-status.js';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Loader2 from '~icons/lucide/loader-2';
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Calendar from '~icons/nucleo/calendar';
	import Clock from '~icons/nucleo/clock';
	import CreditCard from '~icons/nucleo/credit-card';
	import Crown from '~icons/nucleo/crown';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import Globe from '~icons/nucleo/globe';
	import Hash from '~icons/nucleo/hash';
	import Key from '~icons/nucleo/key';
	import Lock from '~icons/nucleo/lock';
	import Mail from '~icons/nucleo/mail';
	import Search from '~icons/nucleo/search';
	import Shield from '~icons/nucleo/shield';
	import ShieldCheck from '~icons/nucleo/shield-check';
	import Terminal from '~icons/nucleo/terminal';
	import Trash2 from '~icons/nucleo/trash';
	import Unlock from '~icons/nucleo/unlock';
	import User from '~icons/nucleo/user';
	import Users from '~icons/nucleo/users';
	import type { PageProps } from './$types';

	type SavingField = 'admin' | 'billingExempt' | 'disabled' | 'twoFactor';
	type ResourceType = 'session' | 'account' | 'org' | 'sshKey' | 'apiToken';
	type UserResources = Awaited<ReturnType<typeof getUserResources>>;
	type OrganizationResources = Awaited<ReturnType<typeof getOrganizationResources>>;

	const resourceViews: Record<
		ResourceType,
		{ count: (user: AdminUser) => number; icon: IconComponent; label: string }
	> = {
		session: { label: 'Sessions', icon: Terminal, count: (user) => user.sessionCount },
		account: { label: 'Accounts', icon: Globe, count: (user) => user.accountCount },
		org: { label: 'Organizations', icon: Users, count: (user) => user.orgCount },
		sshKey: { label: 'SSH Keys', icon: Key, count: (user) => user.sshKeyCount },
		apiToken: { label: 'API Tokens', icon: Fingerprint, count: (user) => user.apiTokenCount }
	};
	const resourceTypes = Object.keys(resourceViews) as ResourceType[];

	const roleOptions = [
		{ value: 'admin', label: 'Admin', icon: Crown },
		{ value: 'user', label: 'User', icon: User }
	] as const;
	const roleFilterOptions = [
		{ value: 'admin', label: 'Admins' },
		{ value: 'user', label: 'Users' }
	] as const;
	const statusFilterOptions = [
		{ value: 'verified', label: 'Verified' },
		{ value: 'unverified', label: 'Unverified' },
		{ value: 'twofa', label: 'With 2FA' },
		{ value: 'disabled', label: 'Disabled' },
		{ value: 'exempt', label: 'Billing exempt' }
	] as const;
	const avatarColors = [
		'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
		'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
		'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-400',
		'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
		'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-400',
		'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-400',
		'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-400',
		'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400'
	];
	const tagClasses = {
		danger: statusBadgeClass.danger,
		success: statusBadgeClass.success,
		muted: 'border-ring/20 bg-muted/30 text-muted-foreground',
		amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
		violet: 'border-violet-500/20 bg-violet-500/10 text-violet-400'
	} as const;

	let { data }: PageProps = $props();

	let users = $derived<AdminUser[]>(data.adminUsers);
	let errorMessage = $state('');
	let saving = $state<Record<string, SavingField>>({});

	let search = $state('');
	let roleFilter = $state<'all' | 'admin' | 'user'>('all');
	let statusFilter = $state<'all' | 'verified' | 'unverified' | 'twofa' | 'disabled' | 'exempt'>(
		'all'
	);

	let drilldownUserId = $state('');
	let drilldownType = $state<ResourceType | null>(null);
	let drilldownOrg = $state<UserOrganization | null>(null);
	let resources = $state<UserResources | null>(null);
	let resourcesLoading = $state(false);
	let orgResources = $state<OrganizationResources | null>(null);
	let orgResourcesLoading = $state(false);

	let twoFactorDisableTarget = $state<AdminUser | null>(null);

	let deletePreparing = $state(false);
	let deleteOpen = $state(false);
	let deletion = $state<{
		id: string;
		name: string;
		email: string;
		method: VerificationMethod;
		verificationEmail: string;
	} | null>(null);

	const usersBase = resolve('admin/users');
	const selectedUser = $derived(
		page.params.id ? (users.find((account) => account.id === page.params.id) ?? null) : null
	);
	const adminCount = $derived(users.filter((u) => u.isAdmin).length);
	const verifiedCount = $derived(users.filter((u) => u.emailVerified).length);
	const twoFactorCount = $derived(users.filter(hasAnyTwoFactor).length);
	const tableUsers = $derived(
		[...users]
			.sort((a, b) => {
				if (a.isAdmin !== b.isAdmin) {
					return a.isAdmin ? -1 : 1;
				}
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			})
			.filter((account) => {
				if (roleFilter === 'admin' && !account.isAdmin) {
					return false;
				}
				if (roleFilter === 'user' && account.isAdmin) {
					return false;
				}
				if (!matchesStatusFilter(account)) {
					return false;
				}
				const term = search.trim().toLowerCase();
				if (!term) {
					return true;
				}
				return [account.name, account.email, account.id].some((value) =>
					value.toLowerCase().includes(term)
				);
			})
	);

	const inDrilldown = $derived(drilldownUserId === selectedUser?.id);
	const resourceType = $derived(inDrilldown ? drilldownType : null);
	const selectedOrg = $derived(inDrilldown ? drilldownOrg : null);

	function matchesStatusFilter(account: AdminUser) {
		switch (statusFilter) {
			case 'verified':
				return account.emailVerified;
			case 'unverified':
				return !account.emailVerified;
			case 'twofa':
				return hasAnyTwoFactor(account);
			case 'disabled':
				return account.disabled;
			case 'exempt':
				return account.billingExempt;
			default:
				return true;
		}
	}

	function twoFactorSummary(account: AdminUser) {
		const hasPasskey = account.passkeyCount > 0;
		if (account.twoFactorEnabled && hasPasskey) {
			return 'Authenticator app and passkey';
		}
		if (account.twoFactorEnabled) {
			return 'Authenticator app enabled';
		}
		return hasPasskey ? 'Passkey enabled' : 'Not enabled';
	}

	function avatarColor(name: string) {
		let hash = 0;
		for (const char of name) {
			hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % avatarColors.length;
		}
		return avatarColors[hash];
	}

	function openUser(userId: string) {
		goto(resolve(`admin/users/${userId}`), { reset: false });
	}

	function closeUser() {
		drilldownType = null;
		drilldownOrg = null;
		goto(usersBase, { reset: false });
	}

	async function updateUser(
		userId: string,
		field: SavingField,
		patch: Partial<AdminUser>,
		commit: () => Promise<unknown>,
		failureMessage: string
	) {
		errorMessage = '';
		saving[userId] = field;
		try {
			await runOptimistic({
				apply: () => {
					const previous = users;
					users = users.map((account) =>
						account.id === userId ? { ...account, ...patch } : account
					);
					return () => {
						users = previous;
					};
				},
				commit,
				invalidates: [dependencies.admin.users]
			});
			return true;
		} catch (err) {
			errorMessage = getErrorMessage(err, failureMessage);
			return false;
		} finally {
			delete saving[userId];
		}
	}

	async function changeAdminAccess(userId: string, isAdmin: boolean) {
		const updated = await updateUser(
			userId,
			'admin',
			{ isAdmin },
			() => setUserAdmin({ userId, isAdmin }),
			'Failed to update admin access'
		);
		if (updated && userId === page.data.user.id && !isAdmin) {
			await goto('/');
		}
	}

	function changeDisabled(userId: string, disabled: boolean) {
		return updateUser(
			userId,
			'disabled',
			{ disabled },
			() => setUserDisabled({ userId, disabled }),
			'Failed to update status'
		);
	}

	function changeBillingExempt(userId: string, billingExempt: boolean) {
		return updateUser(
			userId,
			'billingExempt',
			{ billingExempt },
			() => setUserBillingExempt({ userId, billingExempt }),
			'Failed to update billing exemption'
		);
	}

	function askDisableTwoFactor(account: AdminUser) {
		twoFactorDisableTarget = account;
	}

	function cancelDisableTwoFactor() {
		twoFactorDisableTarget = null;
	}

	function disableTwoFactor() {
		const target = twoFactorDisableTarget;
		twoFactorDisableTarget = null;
		if (target) {
			updateUser(
				target.id,
				'twoFactor',
				{ twoFactorEnabled: false },
				() => setUserTwoFactor({ userId: target.id, twoFactorEnabled: false }),
				'Failed to update two-factor status'
			);
		}
	}

	async function loadUserResources(userId: string, type: ResourceType) {
		drilldownUserId = userId;
		drilldownType = type;
		resourcesLoading = true;
		try {
			const query = getUserResources({ userId });
			await query.refresh();
			resources = await query;
		} catch (err) {
			errorMessage = getErrorMessage(err, 'Failed to load resources');
		} finally {
			resourcesLoading = false;
		}
	}

	async function loadOrgResources(org: UserOrganization) {
		drilldownOrg = org;
		orgResources = null;
		orgResourcesLoading = true;
		try {
			const query = getOrganizationResources({ orgId: org.id });
			await query.refresh();
			orgResources = await query;
		} catch (err) {
			errorMessage = getErrorMessage(err, 'Failed to load organization resources');
		} finally {
			orgResourcesLoading = false;
		}
	}

	async function beginDelete(account: AdminUser) {
		if (deletePreparing) {
			return;
		}
		deletePreparing = true;
		errorMessage = '';
		try {
			const result = await beginDeleteUser({ userId: account.id });
			deletion = {
				id: account.id,
				name: result.targetName,
				email: result.targetEmail,
				method: result.method,
				verificationEmail: result.email
			};
			deleteOpen = true;
		} catch (err) {
			errorMessage = getErrorMessage(err, 'Failed to prepare user deletion');
		} finally {
			deletePreparing = false;
		}
	}

	async function confirmDelete(code: string) {
		if (!deletion) {
			return;
		}
		await deleteUserWithVerification({
			userId: deletion.id,
			method: deletion.method,
			code
		});
		closeUser();
		await invalidate(dependencies.admin.users);
	}
</script>

<svelte:head>
	<title>Users</title>
</svelte:head>

{#snippet statCard(
	Icon: IconComponent,
	tint: string,
	iconClass: string,
	value: number,
	label: string
)}
	<div
		class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
	>
		<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md {tint}">
			<Icon class="h-4 w-4 {iconClass}" />
		</div>
		<div class="flex flex-col">
			<span class="text-lg leading-none font-semibold text-foreground">{value}</span>
			<span class="mt-0.5 text-[10px] text-muted-foreground">{label}</span>
		</div>
	</div>
{/snippet}

{#snippet tag(
	classes: string,
	Icon: IconComponent,
	label: string
)}
	<span
		class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {classes}"
	>
		<Icon class="h-2.5 w-2.5" />{label}
	</span>
{/snippet}

{#snippet sectionTitle(
	title: string
)}
	<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</span>
{/snippet}

{#snippet accountRow(
	Icon: IconComponent,
	label: string,
	value: string,
	valueClass = 'text-muted-foreground'
)}
	<div class="flex items-center justify-between">
		<span class="flex items-center gap-2 text-xs text-muted-foreground">
			<Icon class="h-3 w-3" />{label}
		</span>
		<span class="text-xs {valueClass}">{value}</span>
	</div>
{/snippet}

{#snippet avatar(
	account: AdminUser,
	sizeClass: string,
	shapeClass: string,
	textClass: string
)}
	{#if account.image}
		<img
			src={account.image}
			alt={account.name}
			class="{sizeClass} shrink-0 object-cover {shapeClass}"
		/>
	{:else}
		<div
			class="flex {sizeClass} shrink-0 items-center justify-center font-bold {shapeClass} {textClass} {avatarColor(
				account.name
			)}"
		>
			{initials(account.name)}
		</div>
	{/if}
{/snippet}

{#snippet backHeader(
	title: string,
	onBack: () => void
)}
	<div class="flex items-center gap-2">
		<Button
			variant="ghost"
			size="sm"
			class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
			onclick={onBack}
			aria-label="Back"
		>
			<ChevronLeft class="h-4 w-4" />
		</Button>
		<span class="text-base font-semibold text-foreground">{title}</span>
	</div>
{/snippet}

{#snippet loadingRow()}
	<div class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
		<Loader2 class="h-4 w-4 animate-spin" />
		<span class="text-xs">Loading...</span>
	</div>
{/snippet}

{#snippet toggleRow(
	Icon: IconComponent,
	iconClass: string,
	title: string,
	description: string,
	isSaving: boolean,
	toggle: Snippet
)}
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Icon class="h-4 w-4 {iconClass}" />
			<div class="flex flex-col">
				<span class="text-sm font-medium text-foreground">{title}</span>
				<span class="text-[11px] text-muted-foreground">{description}</span>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if isSaving}
				<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
			{/if}
			{@render toggle()}
		</div>
	</div>
{/snippet}

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if errorMessage}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{errorMessage}
			</div>
		{/if}

		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-base font-semibold tracking-tight text-foreground">Users</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Manage registered users, roles, and account settings.
				</p>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{@render statCard(Users, 'bg-sky-500/10', 'text-sky-400', users.length, 'Total users')}
			{@render statCard(ShieldCheck, 'bg-red-500/10', 'text-red-400', adminCount, 'Admins')}
			{@render statCard(Mail, 'bg-emerald-500/10', 'text-emerald-400', verifiedCount, 'Verified')}
			{@render statCard(Key, 'bg-amber-500/10', 'text-amber-400', twoFactorCount, 'With 2FA')}
		</div>

		<div class="flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-3">
				<div class="relative max-w-xs flex-1">
					<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						bind:value={search}
						placeholder="Search by name, email, ID..."
						class="h-8 pl-8 text-xs"
					/>
				</div>
				<FilterMenu
					label="Role"
					allLabel="All roles"
					options={roleFilterOptions}
					bind:value={roleFilter}
				/>
				<FilterMenu
					label="Status"
					allLabel="All statuses"
					options={statusFilterOptions}
					bind:value={statusFilter}
				/>
			</div>
			{#if tableUsers.length === 0}
				<div class="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
					<Users class="h-8 w-8 text-muted-foreground" />
					<p class="text-sm">No users found</p>
				</div>
			{:else}
				<div class="overflow-x-auto rounded-md border border-border/60">
					<table class="w-full text-left text-xs">
						<thead>
							<tr
								class="border-b border-border/60 bg-background/40 text-[10px] tracking-wider text-muted-foreground uppercase"
							>
								<th class="px-4 py-2.5 font-medium">User</th>
								<th class="px-4 py-2.5 font-medium">Role</th>
								<th class="px-4 py-2.5 font-medium">Status</th>
								<th class="px-4 py-2.5 font-medium">Resources</th>
								<th class="px-4 py-2.5 font-medium">Created</th>
								<th class="px-4 py-2.5">
									<span class="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/50">
							{#each tableUsers as account (account.id)}
								<tr
									class="cursor-pointer transition-colors hover:bg-muted/20"
									onclick={() => openUser(account.id)}
								>
									<td class="px-4 py-2.5">
										<div class="flex items-center gap-2.5">
											{@render avatar(account, 'h-7 w-7', '', 'text-[10px]')}
											<div class="flex min-w-0 flex-col">
												<span class="truncate font-medium text-foreground">{account.name}</span>
												<span class="truncate text-[10px] text-muted-foreground"
													>{account.email}</span
												>
											</div>
										</div>
									</td>
									<td class="px-4 py-2.5">
										{#if account.isAdmin}
											{@render tag(tagClasses.danger, Shield, 'Admin')}
										{:else}
											{@render tag(tagClasses.muted, User, 'User')}
										{/if}
									</td>
									<td class="px-4 py-2.5">
										<div class="flex flex-wrap items-center gap-1">
											{#if account.emailVerified}
												{@render tag(tagClasses.success, Check, 'Verified')}
											{/if}
											{#if hasAnyTwoFactor(account)}
												{@render tag(tagClasses.amber, Key, '2FA')}
											{/if}
											{#if account.disabled}
												{@render tag(tagClasses.danger, X, 'Disabled')}
											{/if}
											{#if account.billingExempt}
												{@render tag(tagClasses.violet, CreditCard, 'Exempt')}
											{/if}
										</div>
									</td>
									<td class="px-4 py-2.5 text-muted-foreground">
										<div class="flex items-center gap-3">
											<span class="flex items-center gap-1" title="Organizations">
												<Users class="h-3 w-3" />{account.orgCount}
											</span>
											<span class="flex items-center gap-1" title="SSH keys">
												<Key class="h-3 w-3" />{account.sshKeyCount}
											</span>
											<span class="flex items-center gap-1" title="Sessions">
												<Terminal class="h-3 w-3" />{account.sessionCount}
											</span>
										</div>
									</td>
									<td class="px-4 py-2.5 text-muted-foreground">
										{formatDate(account.createdAt)}
									</td>
									<td class="px-4 py-2.5 text-right">
										<button
											type="button"
											class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
											aria-label="Open {account.name}"
											onclick={(event) => {
												event.stopPropagation();
												openUser(account.id);
											}}
										>
											<ChevronRight class="h-3.5 w-3.5" />
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	</div>
</div>

<Sheet.Root open={selectedUser !== null} onOpenChange={(open) => !open && closeUser()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if selectedUser && resourceType === null}
			{@const u = selectedUser}
			{@const RoleIcon = u.isAdmin ? Crown : User}
			{@const busy = Boolean(saving[u.id])}
			<div class="flex items-center gap-4">
				{@render avatar(u, 'h-12 w-12', 'rounded-full', 'text-base')}
				<div class="flex min-w-0 flex-col">
					<span class="text-base font-semibold text-foreground">{u.name}</span>
					<span class="truncate text-xs text-muted-foreground">{u.email}</span>
				</div>
			</div>

			<Separator class="bg-muted" />

			<div class="flex flex-col gap-6">
				<div class="flex flex-wrap items-center gap-2">
					{#if u.emailVerified}
						<span
							class="inline-flex items-center gap-1 rounded-sm border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-400"
						>
							<Check class="h-3 w-3" />Email verified
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-1 rounded-sm border border-border/50 bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
						>
							<Mail class="h-3 w-3" />Unverified
						</span>
					{/if}
					{#if u.disabled}
						<span
							class="inline-flex items-center gap-1 rounded-sm border border-red-500/20 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-400"
						>
							<X class="h-3 w-3" />Disabled
						</span>
					{/if}
				</div>

				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium text-muted-foreground">Role</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							disabled={busy}
							class="flex h-9 w-full items-center justify-between rounded-md border border-border/50 bg-muted/40 px-3 text-xs text-foreground transition-colors hover:bg-muted"
						>
							<span class="flex items-center gap-2">
								<RoleIcon class="h-3.5 w-3.5 text-muted-foreground" />
								{u.isAdmin ? 'Admin' : 'User'}
							</span>
							{#if saving[u.id] === 'admin'}
								<Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
							{:else}
								<ChevronDown class="h-3 w-3 text-muted-foreground" />
							{/if}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-56 border-border bg-background">
							<DropdownMenu.Label class="text-xs text-muted-foreground"
								>Change role</DropdownMenu.Label
							>
							<DropdownMenu.Separator class="bg-muted" />
							{#each roleOptions as option (option.value)}
								<DropdownMenu.Item
									class={adminMenuItemClass}
									onSelect={() => changeAdminAccess(u.id, option.value === 'admin')}
								>
									<option.icon class="h-3.5 w-3.5 text-muted-foreground" />
									{option.label}
									{#if u.isAdmin === (option.value === 'admin')}
										<Check class="ml-auto h-3 w-3 text-emerald-400" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-4">
					{@render sectionTitle('Security')}
					{#snippet disabledSwitch()}
						<Switch
							bind:checked={() => u.disabled, (value) => changeDisabled(u.id, value)}
							disabled={busy}
						/>
					{/snippet}
					{@render toggleRow(
						u.disabled ? X : Shield,
						u.disabled ? 'text-red-400' : 'text-emerald-400',
						u.disabled ? 'Disabled' : 'Active',
						u.disabled ? 'User cannot access the platform' : 'Account is in good standing',
						saving[u.id] === 'disabled',
						disabledSwitch
					)}
					{#snippet twoFactorSwitch()}
						<Switch
							bind:checked={() => u.twoFactorEnabled, (value) => !value && askDisableTwoFactor(u)}
							disabled={!u.twoFactorEnabled || busy}
						/>
					{/snippet}
					{@render toggleRow(
						hasAnyTwoFactor(u) ? Lock : Unlock,
						hasAnyTwoFactor(u) ? 'text-emerald-400' : 'text-muted-foreground',
						'Two-factor auth',
						twoFactorSummary(u),
						saving[u.id] === 'twoFactor',
						twoFactorSwitch
					)}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-4">
					{@render sectionTitle('Billing')}
					{#snippet billingExemptSwitch()}
						<Switch
							bind:checked={() => u.billingExempt, (value) => changeBillingExempt(u.id, value)}
							disabled={busy}
						/>
					{/snippet}
					{@render toggleRow(
						CreditCard,
						u.billingExempt ? 'text-violet-400' : 'text-muted-foreground',
						'Billing exempt',
						u.billingExempt
							? 'Usage in projects they own is not metered or billed'
							: 'Usage is metered and billed normally',
						saving[u.id] === 'billingExempt',
						billingExemptSwitch
					)}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3">
					{@render sectionTitle('Account')}
					<div class="flex flex-col gap-2">
						{@render accountRow(Hash, 'User ID', u.id, 'font-mono text-muted-foreground')}
						{@render accountRow(Calendar, 'Created', formatDateTime(u.createdAt))}
						{@render accountRow(Clock, 'Updated', formatDateTime(u.updatedAt))}
						{@render accountRow(Mail, 'Email', u.email)}
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground"
								><Mail class="h-3 w-3" />Verified</span
							>
							<span
								class="flex items-center gap-1 text-xs {u.emailVerified
									? 'text-emerald-400'
									: 'text-muted-foreground'}"
							>
								{#if u.emailVerified}
									<Check class="h-3 w-3" />
								{:else}
									<AlertTriangle class="h-3 w-3" />
								{/if}
								{u.emailVerified ? 'Yes' : 'No'}
							</span>
						</div>
					</div>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3 rounded-sm border border-red-500/20 bg-red-500/5 p-3">
					<div class="flex items-start gap-2">
						<Trash2 class="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-red-300">Delete user</span>
							<span class="text-[11px] leading-4 text-red-300/70">
								Permanently removes this account, sessions, sign-in methods, SSH keys, and API
								tokens.
							</span>
						</div>
					</div>
					<Button
						variant="destructive"
						size="sm"
						class="w-fit gap-1.5 text-xs"
						onclick={() => beginDelete(u)}
						disabled={busy || deletePreparing}
					>
						{#if deletePreparing}
							<Loader2 class="h-3 w-3 animate-spin" />
							Preparing...
						{:else}
							<Trash2 class="h-3 w-3" />
							Delete user
						{/if}
					</Button>
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3">
					{@render sectionTitle('Resources')}
					<div class="grid grid-cols-2 gap-2">
						{#each resourceTypes as type (type)}
							{@const view = resourceViews[type]}
							{@const count = view.count(u)}
							<button
								type="button"
								class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
								onclick={() => count > 0 && loadUserResources(u.id, type)}
							>
								<view.icon class="size-4 shrink-0 text-muted-foreground" />
								<div class="flex flex-col">
									<span class="text-sm font-semibold text-foreground">{count}</span>
									<span class="text-[10px] text-muted-foreground">{view.label}</span>
								</div>
								{#if count > 0}
									<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
								{/if}
							</button>
						{/each}
					</div>
				</div>
			</div>
		{:else if selectedOrg}
			<div class="flex flex-col gap-4">
				{@render backHeader(selectedOrg.name, () => (drilldownOrg = null))}
				<Separator class="bg-muted" />
				{#if orgResourcesLoading}
					{@render loadingRow()}
				{:else}
					<div class="flex flex-col gap-2">
						{@render sectionTitle('Virtual Machines')}
						{#if !orgResources?.vms.length}
							<p class="text-xs text-muted-foreground">No VMs</p>
						{:else}
							<div class="flex flex-col gap-0 divide-y divide-border/50">
								{#each orgResources.vms as vm (vm.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="flex flex-col">
											<span class="text-xs text-foreground">{vm.name}</span>
											<span class="text-[11px] text-muted-foreground"
												>{formatDateTime(vm.createdAt)}</span
											>
										</div>
										<Badge variant="secondary" class="text-[10px]">{vm.status}</Badge>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<Separator class="bg-muted" />
					<div class="flex flex-col gap-2">
						{@render sectionTitle('Volumes')}
						{#if !orgResources?.volumes.length}
							<p class="text-xs text-muted-foreground">No volumes</p>
						{:else}
							<div class="flex flex-col gap-0 divide-y divide-border/50">
								{#each orgResources.volumes as vol (vol.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="flex flex-col">
											<span class="text-xs text-foreground">{vol.name}</span>
											<span class="text-[11px] text-muted-foreground"
												>{vol.size}
												GB · {formatDateTime(vol.createdAt)}</span
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else if resourceType !== null && selectedUser}
			{@const view = resourceViews[resourceType]}
			<div class="flex flex-col gap-4">
				{@render backHeader(selectedUser.name, () => (drilldownType = null))}
				<Separator class="bg-muted" />
				<div class="flex items-center gap-2">
					<view.icon class="h-4 w-4 text-muted-foreground" />
					<span class="text-sm font-semibold text-foreground">{view.label}</span>
				</div>
				{#if resourcesLoading}
					{@render loadingRow()}
				{:else if resourceType === 'session'}
					{#if !resources?.sessions.length}
						<p class="py-4 text-xs text-muted-foreground">No sessions found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each resources.sessions as s (s.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="font-mono text-xs text-muted-foreground">{s.id}</span>
									{#if s.ipAddress}
										<span class="text-[11px] text-muted-foreground">IP: {s.ipAddress}</span>
									{/if}
									<span class="text-[11px] text-muted-foreground"
										>{formatDateTime(s.createdAt)}</span
									>
								</div>
							{/each}
						</div>
					{/if}
				{:else if resourceType === 'account'}
					{#if !resources?.accounts.length}
						<p class="py-4 text-xs text-muted-foreground">No accounts found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each resources.accounts as a (a.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs font-medium text-foreground">{a.providerId}</span>
									<span class="font-mono text-[11px] text-muted-foreground">{a.accountId}</span>
									<span class="text-[11px] text-muted-foreground"
										>{formatDateTime(a.createdAt)}</span
									>
								</div>
							{/each}
						</div>
					{/if}
				{:else if resourceType === 'org'}
					{#if !resources?.members.length}
						<p class="py-4 text-xs text-muted-foreground">No organizations found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each resources.members as o (o.id)}
								<button
									type="button"
									class="flex items-center justify-between py-2.5 text-left transition-colors"
									onclick={() => loadOrgResources(o)}
								>
									<span class="text-xs text-foreground">{o.name}</span>
									<div class="flex items-center gap-1.5">
										<Badge variant="secondary" class="text-[10px]">{o.role}</Badge>
										<ChevronRight class="h-3 w-3 text-muted-foreground" />
									</div>
								</button>
							{/each}
						</div>
					{/if}
				{:else if resourceType === 'sshKey'}
					{#if !resources?.sshKeys.length}
						<p class="py-4 text-xs text-muted-foreground">No SSH keys found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each resources.sshKeys as k (k.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs text-foreground">{k.name}</span>
									<span class="font-mono text-[11px] text-muted-foreground">{k.fingerprint}</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if resourceType === 'apiToken'}
					{#if !resources?.apiTokens.length}
						<p class="py-4 text-xs text-muted-foreground">No API tokens found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each resources.apiTokens as t (t.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs text-foreground">{t.name}</span>
									<span class="text-[11px] text-muted-foreground"
										>{formatDateTime(t.createdAt)}</span
									>
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

{#if deletion}
	<VerificationDialog
		bind:open={deleteOpen}
		method={deletion.method}
		title="Delete {deletion.name}?"
		description={describeDeletionVerification(
			deletion.method,
			deletion.email,
			deletion.verificationEmail
		)}
		emailHint="We sent a deletion code to {deletion.verificationEmail}."
		destructive
		submitLabel="Delete user"
		passkeySubmitLabel="Verify and delete"
		submittingLabel="Deleting..."
		failureMessage="Failed to delete user"
		confirm={confirmDelete}
	>
		<div
			class="flex flex-col gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-200/80"
		>
			<p class="font-medium text-red-200">This action cannot be undone.</p>
			<p>
				Deleting {deletion.email} permanently removes their account, sessions, sign-in methods, SSH
				keys, and API tokens.
			</p>
			<p>
				If they are the only member of an organization, that organization and all of its servers,
				volumes, invitations, and local billing records will also be deleted.
			</p>
			<p>
				If an organization has other members, the oldest remaining member will be promoted to owner.
			</p>
		</div>
	</VerificationDialog>
{/if}

<Dialog.Root
	open={twoFactorDisableTarget !== null}
	onOpenChange={(open) => !open && cancelDisableTwoFactor()}
>
	<Dialog.Content class="border-border bg-background sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Disable two-factor auth?</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{twoFactorDisableTarget?.name ?? 'This user'}
				will be required to reconfigure 2FA on their next sign-in. This reduces account security.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex items-center gap-2 pt-4">
			<Button
				variant="outline"
				size="sm"
				class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => (twoFactorDisableTarget = null)}
				>Cancel</Button
			>
			<Button size="sm" class="text-xs" onclick={disableTwoFactor}>Confirm disable</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
