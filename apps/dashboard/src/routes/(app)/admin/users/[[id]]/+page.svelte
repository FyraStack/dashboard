<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { beginDeleteUser, type AdminUser } from '$lib/remote/admin-users.remote';
	import { getErrorMessage } from '$lib/utils';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import Calendar from '~icons/nucleo/calendar';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Clock from '~icons/nucleo/clock';
	import Loader2 from '~icons/lucide/loader-2';
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import CreditCard from '~icons/nucleo/credit-card';
	import Crown from '~icons/nucleo/crown';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import Globe from '~icons/nucleo/globe';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Hash from '~icons/nucleo/hash';
	import Key from '~icons/nucleo/key';
	import Lock from '~icons/nucleo/lock';
	import Mail from '~icons/nucleo/mail';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import Shield from '~icons/nucleo/shield';
	import ShieldCheck from '~icons/nucleo/shield-check';
	import Terminal from '~icons/nucleo/terminal';
	import Trash2 from '~icons/nucleo/trash';
	import Unlock from '~icons/nucleo/unlock';
	import User from '~icons/nucleo/user';
	import Users from '~icons/nucleo/users';

	type DeletionVerificationMethod = 'passkey' | 'totp' | 'email';
	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	const usersBase = resolve('/admin/users');

	function openUser(userId: string) {
		void goto(resolve(`/admin/users/${userId}`), {
			noScroll: true,
			keepFocus: true
		});
	}

	function closeUser() {
		void goto(usersBase, { noScroll: true, keepFocus: true });
	}

	$effect(() => {
		const id = page.params.id;
		if (!id) {
			if (admin.userSheetOpen) admin.closeUserSheet();
			return;
		}
		const target = admin.adminUsers.find((account) => account.id === id);
		if (target) admin.openUserSheet(target);
	});

	const adminCount = $derived(admin.adminUsers.filter((u) => u.isAdmin).length);
	const userCount = $derived(admin.adminUsers.length);
	const verifiedCount = $derived(admin.adminUsers.filter((u) => u.emailVerified).length);
	const disabledCount = $derived(admin.adminUsers.filter((u) => u.disabled).length);
	const has2faCount = $derived(
		admin.adminUsers.filter((u) => u.twoFactorEnabled || u.passkeyCount > 0).length
	);
	let deleteDialogOpen = $state(false);
	let deletePreparing = $state(false);
	let deleteVerifying = $state(false);
	let deleteError = $state('');
	let deleteUserId = $state('');
	let deleteUserName = $state('');
	let deleteUserEmail = $state('');
	let deleteVerificationMethod = $state<DeletionVerificationMethod>('email');
	let deleteVerificationEmail = $state('');
	let deleteVerificationCode = $state('');
	const normalizedDeleteVerificationCode = $derived(deleteVerificationCode.replace(/\D/g, ''));
	const deleteVerificationDescription = $derived.by(() => {
		if (deleteVerificationMethod === 'passkey') {
			return `Use your registered passkey to confirm permanently deleting ${deleteUserEmail}.`;
		}

		if (deleteVerificationMethod === 'totp') {
			return `Enter a code from your authenticator app to confirm permanently deleting ${deleteUserEmail}.`;
		}

		return `Enter the code sent to ${deleteVerificationEmail} to confirm permanently deleting ${deleteUserEmail}.`;
	});
	const deleteVerificationDisabled = $derived(
		deleteVerifying ||
			deletePreparing ||
			!deleteUserId ||
			(deleteVerificationMethod !== 'passkey' && normalizedDeleteVerificationCode.length !== 6)
	);

	const sortedUsers = $derived(
		[...admin.adminUsers].sort((a, b) => {
			if (a.isAdmin && !b.isAdmin) return -1;
			if (!a.isAdmin && b.isAdmin) return 1;
			return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
		})
	);

	let userSearch = $state('');
	let roleFilter = $state<'all' | 'admin' | 'user'>('all');
	let statusFilter = $state<'all' | 'verified' | 'unverified' | 'twofa' | 'disabled' | 'exempt'>(
		'all'
	);

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
	const roleFilterLabel = $derived(
		roleFilterOptions.find((option) => option.value === roleFilter)?.label ?? 'All'
	);
	const statusFilterLabel = $derived(
		statusFilterOptions.find((option) => option.value === statusFilter)?.label ?? 'All'
	);

	function matchesStatusFilter(account: AdminUser) {
		if (statusFilter === 'verified') return account.emailVerified;
		if (statusFilter === 'unverified') return !account.emailVerified;
		if (statusFilter === 'twofa') return account.twoFactorEnabled || account.passkeyCount > 0;
		if (statusFilter === 'disabled') return account.disabled;
		if (statusFilter === 'exempt') return account.billingExempt;
		return true;
	}

	const tableUsers = $derived(
		sortedUsers.filter((account) => {
			if (roleFilter === 'admin' && !account.isAdmin) return false;
			if (roleFilter === 'user' && account.isAdmin) return false;
			if (!matchesStatusFilter(account)) return false;
			const term = userSearch.trim().toLowerCase();
			if (!term) return true;
			return [account.name, account.email, account.id].some((value) =>
				value.toLowerCase().includes(term)
			);
		})
	);

	function formatDate(date: Date) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(date)
		);
	}

	function formatDateShort(date: Date) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(date));
	}

	function initials(name: string) {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	}

	function avatarColor(name: string) {
		const colors = [
			'bg-red-500/20 text-red-400',
			'bg-emerald-500/20 text-emerald-400',
			'bg-sky-500/20 text-sky-400',
			'bg-amber-500/20 text-amber-400',
			'bg-violet-500/20 text-violet-400',
			'bg-rose-500/20 text-rose-400',
			'bg-cyan-500/20 text-cyan-400',
			'bg-orange-500/20 text-orange-400'
		];
		let hash = 0;
		for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
		return colors[Math.abs(hash) % colors.length];
	}

	const roleOptions = [
		{ value: 'admin', label: 'Admin', icon: Crown },
		{ value: 'user', label: 'User', icon: User }
	] as const;

	const resourceLabels = {
		session: { label: 'Sessions', icon: Terminal },
		account: { label: 'Accounts', icon: Globe },
		org: { label: 'Organizations', icon: Users },
		sshKey: { label: 'SSH Keys', icon: Key },
		apiToken: { label: 'API Tokens', icon: Fingerprint },
		vm: { label: 'Virtual Machines', icon: Server },
		volume: { label: 'Volumes', icon: HardDrive }
	} as const;

	function resetDeleteDialog() {
		deleteDialogOpen = false;
		deleteError = '';
		deleteUserId = '';
		deleteUserName = '';
		deleteUserEmail = '';
		deleteVerificationMethod = 'email';
		deleteVerificationEmail = '';
		deleteVerificationCode = '';
	}

	async function openDeleteDialog(user: AdminUser) {
		if (deletePreparing || deleteVerifying) return;

		deletePreparing = true;
		deleteError = '';
		deleteUserId = user.id;
		deleteUserName = user.name;
		deleteUserEmail = user.email;
		deleteVerificationCode = '';

		try {
			const result = await beginDeleteUser({ userId: user.id });
			deleteUserName = result.targetName;
			deleteUserEmail = result.targetEmail;
			deleteVerificationMethod = result.method;
			deleteVerificationEmail = result.email;
			deleteDialogOpen = true;
		} catch (err) {
			admin.adminUserError = getErrorMessage(err, 'Failed to prepare user deletion');
			deleteUserId = '';
		} finally {
			deletePreparing = false;
		}
	}

	async function confirmDeleteUser() {
		if (deleteVerificationDisabled) return;

		deleteVerifying = true;
		deleteError = '';

		try {
			if (deleteVerificationMethod === 'passkey') {
				const { error } = await authClient.signIn.passkey({ autoFill: false });

				if (error) {
					deleteError = error.message ?? 'Failed to verify passkey.';
					return;
				}
			}

			await admin.deleteUser(
				deleteUserId,
				deleteVerificationMethod,
				normalizedDeleteVerificationCode
			);
			resetDeleteDialog();
			closeUser();
		} catch (err) {
			deleteError = getErrorMessage(err, 'Failed to delete user');
		} finally {
			deleteVerifying = false;
		}
	}
</script>

<svelte:head>
	<title>Users</title>
</svelte:head>

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if admin.adminUserError}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{admin.adminUserError}
			</div>
		{/if}

		<!-- Header -->
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-base font-semibold tracking-tight text-foreground">Users</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Manage registered users, roles, and account settings.
				</p>
			</div>
		</div>

		<!-- Stat row -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10">
					<Users class="h-4 w-4 text-sky-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{userCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Total users</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/10">
					<ShieldCheck class="h-4 w-4 text-red-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{adminCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Admins</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
					<Mail class="h-4 w-4 text-emerald-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{verifiedCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Verified</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10">
					<Key class="h-4 w-4 text-amber-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{has2faCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">With 2FA</span>
				</div>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<div class="flex flex-wrap items-center gap-3">
				<div class="relative max-w-xs flex-1">
					<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						bind:value={userSearch}
						placeholder="Search by name, email, ID..."
						class="h-8 pl-8 text-xs"
					/>
				</div>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs {roleFilter === 'all'
								? 'text-muted-foreground'
								: 'text-foreground'} hover:bg-muted hover:text-foreground"
						>
							Role: {roleFilterLabel}
							<ChevronDown class="h-3 w-3 text-muted-foreground" />
						</Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-44 border-border bg-background">
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (roleFilter = 'all')}
						>
							All roles
							{#if roleFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
						</DropdownMenu.Item>
						<DropdownMenu.Separator class="bg-muted" />
						{#each roleFilterOptions as option (option.value)}
							<DropdownMenu.Item
								class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
								onSelect={() => (roleFilter = option.value)}
							>
								{option.label}
								{#if roleFilter === option.value}
									<Check class="ml-auto h-3 w-3 text-emerald-400" />
								{/if}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						<Button
							variant="outline"
							size="sm"
							class="h-8 gap-1.5 border-border/50 text-xs {statusFilter === 'all'
								? 'text-muted-foreground'
								: 'text-foreground'} hover:bg-muted hover:text-foreground"
						>
							Status: {statusFilterLabel}
							<ChevronDown class="h-3 w-3 text-muted-foreground" />
						</Button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-44 border-border bg-background">
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (statusFilter = 'all')}
						>
							All statuses
							{#if statusFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
						</DropdownMenu.Item>
						<DropdownMenu.Separator class="bg-muted" />
						{#each statusFilterOptions as option (option.value)}
							<DropdownMenu.Item
								class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
								onSelect={() => (statusFilter = option.value)}
							>
								{option.label}
								{#if statusFilter === option.value}
									<Check class="ml-auto h-3 w-3 text-emerald-400" />
								{/if}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
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
								<th class="px-4 py-2.5"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/50">
							{#each tableUsers as account (account.id)}
								{@const colorClass = avatarColor(account.name)}
								<tr
									class="cursor-pointer transition-colors hover:bg-muted/20"
									onclick={() => openUser(account.id)}
								>
									<td class="px-4 py-2.5">
										<div class="flex items-center gap-2.5">
											{#if account.image}
												<img
													src={account.image}
													alt={account.name}
													class="h-7 w-7 shrink-0 object-cover"
												/>
											{:else}
												<div
													class="flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-bold {colorClass}"
												>
													{initials(account.name)}
												</div>
											{/if}
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
											<span
												class="inline-flex items-center gap-1 rounded-sm border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
											>
												<Shield class="h-2.5 w-2.5" />Admin
											</span>
										{:else}
											<span
												class="inline-flex items-center gap-1 rounded-sm border border-ring/20 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
											>
												<User class="h-2.5 w-2.5" />User
											</span>
										{/if}
									</td>
									<td class="px-4 py-2.5">
										<div class="flex flex-wrap items-center gap-1">
											{#if account.emailVerified}
												<span
													class="inline-flex items-center gap-1 rounded-sm border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
												>
													<Check class="h-2.5 w-2.5" />Verified
												</span>
											{/if}
											{#if account.twoFactorEnabled || account.passkeyCount > 0}
												<span
													class="inline-flex items-center gap-1 rounded-sm border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400"
												>
													<Key class="h-2.5 w-2.5" />2FA
												</span>
											{/if}
											{#if account.disabled}
												<span
													class="inline-flex items-center gap-1 rounded-sm border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
												>
													<X class="h-2.5 w-2.5" />Disabled
												</span>
											{/if}
											{#if account.billingExempt}
												<span
													class="inline-flex items-center gap-1 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400"
												>
													<CreditCard class="h-2.5 w-2.5" />Exempt
												</span>
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
										{formatDateShort(account.createdAt)}
									</td>
									<td class="px-4 py-2.5 text-right">
										<ChevronRight class="ml-auto h-3.5 w-3.5 text-muted-foreground" />
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

<!-- User Detail Sheet -->
<Sheet.Root open={admin.userSheetOpen} onOpenChange={(v) => !v && closeUser()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if admin.selectedUser && admin.userResourcesOpen === null}
			{@const u = admin.selectedUser}
			{@const colorClass = avatarColor(u.name)}
			{@const RoleIcon = u.isAdmin ? Crown : User}
			{@const isAdminSaving = admin.adminUserSaving[u.id] || admin.userSheetSaving[u.id]?.saving}
			<!-- Header -->
			<div class="flex items-center gap-4">
				{#if u.image}
					<img src={u.image} alt={u.name} class="h-12 w-12 shrink-0 rounded-full object-cover" />
				{:else}
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold {colorClass}"
					>
						{initials(u.name)}
					</div>
				{/if}
				<div class="flex min-w-0 flex-col">
					<span class="text-base font-semibold text-foreground">{u.name}</span>
					<span class="truncate text-xs text-muted-foreground">{u.email}</span>
				</div>
			</div>

			<Separator class="bg-muted" />

			<div class="flex flex-col gap-6">
				<!-- Status badges -->
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

				<!-- Role -->
				<div class="flex flex-col gap-2">
					<span class="text-xs font-medium text-muted-foreground">Role</span>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger disabled={isAdminSaving}>
							<Button
								variant="outline"
								class="h-9 w-full justify-between border-border/50 bg-muted/40 text-xs text-foreground hover:bg-muted"
							>
								<span class="flex items-center gap-2">
									<RoleIcon class="h-3.5 w-3.5 text-muted-foreground" />
									{u.isAdmin ? 'Admin' : 'User'}
								</span>
								{#if isAdminSaving}
									<Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
								{:else}
									<ChevronDown class="h-3 w-3 text-muted-foreground" />
								{/if}
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-56 border-border bg-background">
							<DropdownMenu.Label class="text-xs text-muted-foreground"
								>Change role</DropdownMenu.Label
							>
							<DropdownMenu.Separator class="bg-muted" />
							{#each roleOptions as option (option.value)}
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
									onSelect={() =>
										option.value === 'admin'
											? admin.setUserAdmin(u.id, true)
											: admin.setUserAdmin(u.id, false)}
								>
									<option.icon class="h-3.5 w-3.5 text-muted-foreground" />
									{option.label}
									{#if (u.isAdmin && option.value === 'admin') || (!u.isAdmin && option.value === 'user')}
										<Check class="ml-auto h-3 w-3 text-emerald-400" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<Separator class="bg-muted" />

				<!-- Security toggles -->
				<div class="flex flex-col gap-4">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Security</span
					>

					<!-- Disabled toggle -->
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							{#if u.disabled}
								<X class="h-4 w-4 text-red-400" />
							{:else}
								<Shield class="h-4 w-4 text-emerald-400" />
							{/if}
							<div class="flex flex-col">
								<span class="text-sm font-medium text-foreground">
									{u.disabled ? 'Disabled' : 'Active'}
								</span>
								<span class="text-[11px] text-muted-foreground">
									{u.disabled ? 'User cannot access the platform' : 'Account is in good standing'}
								</span>
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if admin.userSheetSaving[u.id]?.field === 'disabled' && admin.userSheetSaving[u.id]?.saving}
								<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							{/if}
							<Switch
								bind:checked={() => u.disabled, (v) => admin.setUserDisabled(u.id, v)}
								disabled={isAdminSaving}
							/>
						</div>
					</div>

					<!-- 2FA toggle -->
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							{#if u.twoFactorEnabled || u.passkeyCount > 0}
								<Lock class="h-4 w-4 text-emerald-400" />
							{:else}
								<Unlock class="h-4 w-4 text-muted-foreground" />
							{/if}
							<div class="flex flex-col">
								<span class="text-sm font-medium text-foreground">Two-factor auth</span>
								<span class="text-[11px] text-muted-foreground">
									{u.twoFactorEnabled && u.passkeyCount > 0
										? 'Authenticator app and passkey'
										: u.twoFactorEnabled
											? 'Authenticator app enabled'
											: u.passkeyCount > 0
												? 'Passkey enabled'
												: 'Not enabled'}
								</span>
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if admin.userSheetSaving[u.id]?.field === 'twoFactor' && admin.userSheetSaving[u.id]?.saving}
								<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							{/if}
							<Switch
								bind:checked={
									() => u.twoFactorEnabled,
									(v) => (u.twoFactorEnabled ? admin.prompt2FAConfirm(u.id, v) : undefined)
								}
								disabled={!u.twoFactorEnabled || isAdminSaving}
							/>
						</div>
					</div>
				</div>

				<Separator class="bg-muted" />

				<!-- Billing -->
				<div class="flex flex-col gap-4">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Billing</span
					>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<CreditCard
								class="h-4 w-4 {u.billingExempt ? 'text-violet-400' : 'text-muted-foreground'}"
							/>
							<div class="flex flex-col">
								<span class="text-sm font-medium text-foreground">Billing exempt</span>
								<span class="text-[11px] text-muted-foreground">
									{u.billingExempt
										? 'Usage in projects they own is not metered or billed'
										: 'Usage is metered and billed normally'}
								</span>
							</div>
						</div>
						<div class="flex items-center gap-2">
							{#if admin.userSheetSaving[u.id]?.field === 'billingExempt' && admin.userSheetSaving[u.id]?.saving}
								<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
							{/if}
							<Switch
								bind:checked={() => u.billingExempt, (v) => admin.setUserBillingExempt(u.id, v)}
								disabled={isAdminSaving}
							/>
						</div>
					</div>
				</div>

				<Separator class="bg-muted" />

				<!-- Account info -->
				<div class="flex flex-col gap-3">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Account</span
					>
					<div class="flex flex-col gap-2">
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Hash class="h-3 w-3" />User ID
							</span>
							<span class="font-mono text-xs text-muted-foreground">{u.id}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Calendar class="h-3 w-3" />Created
							</span>
							<span class="text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Clock class="h-3 w-3" />Updated
							</span>
							<span class="text-xs text-muted-foreground">{formatDate(u.updatedAt)}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Mail class="h-3 w-3" />Email
							</span>
							<span class="text-xs text-muted-foreground">{u.email}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="flex items-center gap-2 text-xs text-muted-foreground">
								<Mail class="h-3 w-3" />Verified
							</span>
							<span
								class="flex items-center gap-1 text-xs {u.emailVerified
									? 'text-emerald-400'
									: 'text-muted-foreground'}"
							>
								{#if u.emailVerified}<Check class="h-3 w-3" />{:else}<AlertTriangle
										class="h-3 w-3"
									/>{/if}
								{u.emailVerified ? 'Yes' : 'No'}
							</span>
						</div>
					</div>
				</div>

				<Separator class="bg-muted" />

				<!-- Danger zone -->
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
						onclick={() => openDeleteDialog(u)}
						disabled={isAdminSaving || deletePreparing}
					>
						{#if deletePreparing && deleteUserId === u.id}
							<Loader2 class="h-3 w-3 animate-spin" />
							Preparing...
						{:else}
							<Trash2 class="h-3 w-3" />
							Delete user
						{/if}
					</Button>
				</div>

				<Separator class="bg-muted" />

				<!-- Resources counts with click-to-expand -->
				<div class="flex flex-col gap-3">
					<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
						>Resources</span
					>
					<div class="grid grid-cols-2 gap-2">
						<button
							class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
							onclick={() => u.sessionCount > 0 && admin.loadUserResources(u.id, 'session')}
						>
							<Terminal class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex flex-col">
								<span class="text-sm font-semibold text-foreground">{u.sessionCount}</span>
								<span class="text-[10px] text-muted-foreground">Sessions</span>
							</div>
							{#if u.sessionCount > 0}
								<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
							onclick={() => u.accountCount > 0 && admin.loadUserResources(u.id, 'account')}
						>
							<Globe class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex flex-col">
								<span class="text-sm font-semibold text-foreground">{u.accountCount}</span>
								<span class="text-[10px] text-muted-foreground">Accounts</span>
							</div>
							{#if u.accountCount > 0}
								<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
							onclick={() => u.orgCount > 0 && admin.loadUserResources(u.id, 'org')}
						>
							<Users class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex flex-col">
								<span class="text-sm font-semibold text-foreground">{u.orgCount}</span>
								<span class="text-[10px] text-muted-foreground">Organizations</span>
							</div>
							{#if u.orgCount > 0}
								<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
							onclick={() => u.sshKeyCount > 0 && admin.loadUserResources(u.id, 'sshKey')}
						>
							<Key class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex flex-col">
								<span class="text-sm font-semibold text-foreground">{u.sshKeyCount}</span>
								<span class="text-[10px] text-muted-foreground">SSH Keys</span>
							</div>
							{#if u.sshKeyCount > 0}
								<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/40"
							onclick={() => u.apiTokenCount > 0 && admin.loadUserResources(u.id, 'apiToken')}
						>
							<Fingerprint class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex flex-col">
								<span class="text-sm font-semibold text-foreground">{u.apiTokenCount}</span>
								<span class="text-[10px] text-muted-foreground">API Tokens</span>
							</div>
							{#if u.apiTokenCount > 0}
								<ChevronRight class="ml-auto h-3 w-3 text-muted-foreground" />
							{/if}
						</button>
					</div>
				</div>
			</div>
		{:else if admin.orgResourcesOpen && admin.selectedOrg}
			{@const org = admin.selectedOrg}
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
						onclick={() => admin.closeOrgResources()}
						aria-label="Back"
					>
						<ChevronLeft class="h-4 w-4" />
					</Button>
					<span class="text-base font-semibold text-foreground">{org.name}</span>
				</div>
				<Separator class="bg-muted" />
				{#if admin.orgResourcesLoading}
					<div class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
						<Loader2 class="h-4 w-4 animate-spin" />
						<span class="text-xs">Loading...</span>
					</div>
				{:else}
					<div class="flex flex-col gap-2">
						<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
							>Virtual Machines</span
						>
						{#if admin.orgVms.length === 0}
							<p class="text-xs text-muted-foreground">No VMs</p>
						{:else}
							<div class="flex flex-col gap-0 divide-y divide-border/50">
								{#each admin.orgVms as vm (vm.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="flex flex-col">
											<span class="text-xs text-foreground">{vm.name}</span>
											<span class="text-[11px] text-muted-foreground"
												>{new Date(vm.createdAt).toLocaleString()}</span
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
						<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
							>Volumes</span
						>
						{#if admin.orgVolumes.length === 0}
							<p class="text-xs text-muted-foreground">No volumes</p>
						{:else}
							<div class="flex flex-col gap-0 divide-y divide-border/50">
								{#each admin.orgVolumes as vol (vol.id)}
									<div class="flex items-center justify-between py-2.5">
										<div class="flex flex-col">
											<span class="text-xs text-foreground">{vol.name}</span>
											<span class="text-[11px] text-muted-foreground"
												>{vol.size} GB · {new Date(vol.createdAt).toLocaleString()}</span
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else if admin.userResourcesOpen !== null && admin.selectedUser}
			{@const u = admin.selectedUser}
			{@const type = admin.userResourcesOpen}
			{@const info = resourceLabels[type]}
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
						onclick={() => admin.closeUserResources()}
						aria-label="Back"
					>
						<ChevronLeft class="h-4 w-4" />
					</Button>
					<span class="text-base font-semibold text-foreground">{u.name}</span>
				</div>
				<Separator class="bg-muted" />
				<div class="flex items-center gap-2">
					<info.icon class="h-4 w-4 text-muted-foreground" />
					<span class="text-sm font-semibold text-foreground">{info.label}</span>
				</div>
				{#if admin.userResourcesLoading}
					<div class="flex items-center justify-center gap-2 py-8 text-muted-foreground">
						<Loader2 class="h-4 w-4 animate-spin" />
						<span class="text-xs">Loading...</span>
					</div>
				{:else if type === 'session'}
					{#if admin.userSessions.length === 0}
						<p class="py-4 text-xs text-muted-foreground">No sessions found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each admin.userSessions as s (s.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="font-mono text-xs text-muted-foreground">{s.id}</span>
									{#if s.ipAddress}
										<span class="text-[11px] text-muted-foreground">IP: {s.ipAddress}</span>
									{/if}
									<span class="text-[11px] text-muted-foreground">{formatDate(s.createdAt)}</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if type === 'account'}
					{#if admin.userAccounts.length === 0}
						<p class="py-4 text-xs text-muted-foreground">No accounts found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each admin.userAccounts as a (a.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs font-medium text-foreground">{a.providerId}</span>
									<span class="font-mono text-[11px] text-muted-foreground">{a.accountId}</span>
									<span class="text-[11px] text-muted-foreground">{formatDate(a.createdAt)}</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if type === 'org'}
					{#if admin.userOrgs.length === 0}
						<p class="py-4 text-xs text-muted-foreground">No organizations found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each admin.userOrgs as o (o.id)}
								<button
									class="flex items-center justify-between py-2.5 text-left transition-colors"
									onclick={() => admin.loadOrgResources(o)}
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
				{:else if type === 'sshKey'}
					{#if admin.userSshKeys.length === 0}
						<p class="py-4 text-xs text-muted-foreground">No SSH keys found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each admin.userSshKeys as k (k.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs text-foreground">{k.name}</span>
									<span class="font-mono text-[11px] text-muted-foreground">{k.fingerprint}</span>
								</div>
							{/each}
						</div>
					{/if}
				{:else if type === 'apiToken'}
					{#if admin.userApiTokens.length === 0}
						<p class="py-4 text-xs text-muted-foreground">No API tokens found</p>
					{:else}
						<div class="flex flex-col gap-0 divide-y divide-border/50">
							{#each admin.userApiTokens as t (t.id)}
								<div class="flex flex-col gap-0.5 py-2.5">
									<span class="text-xs text-foreground">{t.name}</span>
									<span class="text-[11px] text-muted-foreground"
										>{new Date(t.createdAt).toLocaleString()}</span
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

<!-- User Deletion Verification Modal -->
<Dialog.Root
	bind:open={deleteDialogOpen}
	onOpenChange={(value) => {
		if (!value && !deleteVerifying) resetDeleteDialog();
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Delete {deleteUserName}?</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{deleteVerificationDescription}
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-4"
			onsubmit={(event) => {
				event.preventDefault();
				void confirmDeleteUser();
			}}
		>
			<div
				class="flex flex-col gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-200/80"
			>
				<p class="font-medium text-red-200">This action cannot be undone.</p>
				<p>
					Deleting {deleteUserEmail} permanently removes their account, sessions, sign-in methods, SSH
					keys, and API tokens.
				</p>
				<p>
					If they are the only member of an organization, that organization and all of its servers,
					volumes, invitations, and local billing records will also be deleted.
				</p>
				<p>
					If an organization has other members, the oldest remaining member will be promoted to
					owner.
				</p>
			</div>

			{#if deleteVerificationMethod === 'passkey'}
				<div class="flex items-center gap-3 rounded-sm border border-border bg-background/40 p-3">
					<Fingerprint class="size-5 shrink-0 text-muted-foreground" />
					<p class="text-sm text-muted-foreground">
						Your browser will ask you to authenticate with your registered passkey.
					</p>
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label>
						{deleteVerificationMethod === 'totp' ? 'Authenticator Code' : 'Email Verification Code'}
					</Label>
					<Input
						bind:value={deleteVerificationCode}
						inputmode="numeric"
						placeholder="000000"
						maxlength={6}
						autocomplete="one-time-code"
					/>
					{#if deleteVerificationMethod === 'email'}
						<p class="text-xs text-muted-foreground">
							We sent a deletion code to {deleteVerificationEmail}.
						</p>
					{/if}
				</div>
			{/if}

			{#if deleteError}
				<p class="text-xs text-red-400">{deleteError}</p>
			{/if}

			<Dialog.Footer class="flex items-center gap-2 pt-2">
				<Button
					variant="outline"
					type="button"
					size="sm"
					class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => resetDeleteDialog()}
					disabled={deleteVerifying}
				>
					Cancel
				</Button>
				<Button
					variant="destructive"
					type="submit"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={deleteVerificationDisabled}
				>
					{#if deleteVerifying}
						<Loader2 class="h-3 w-3 animate-spin" />
						Deleting...
					{:else}
						<Trash2 class="h-3 w-3" />
						{deleteVerificationMethod === 'passkey' ? 'Verify and delete' : 'Delete user'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<!-- 2FA Disable Confirmation Modal (only for disabling) -->
<Dialog.Root open={admin.twoFADialogOpen} onOpenChange={(v) => !v && admin.cancel2FAConfirm()}>
	<Dialog.Content class="border-border bg-background sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Disable two-factor auth?</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{admin.selectedUser?.name ?? 'This user'} will be required to reconfigure 2FA on their next sign-in.
				This reduces account security.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex items-center gap-2 pt-4">
			<Button
				variant="outline"
				size="sm"
				class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => admin.cancel2FAConfirm()}
			>
				Cancel
			</Button>
			<Button size="sm" class="text-xs" onclick={() => admin.commit2FAConfirm()}>
				{#if admin.userSheetSaving[admin.twoFAPendingUserId]?.saving}
					<Loader2 class="h-3 w-3 animate-spin" />
				{:else}
					Confirm disable
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
