<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import VmBillingReversalDialog from '$lib/components/admin/vm-billing-reversal-dialog.svelte';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { generateServerName } from '$lib/name-generator';
	import {
		beginDeleteProject,
		createAdminProject,
		createAdminVm,
		deleteProjectWithVerification,
		setProjectDisabled,
		type AdminProject
	} from '$lib/remote/admin-projects.remote';
	import { getUserResources, type UserSshKey } from '$lib/remote/admin-users.remote';
	import type { AdminVm } from '$lib/remote/admin-vms.remote';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import { getErrorMessage, runQuery } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Loader2 from '~icons/lucide/loader-2';
	import MoreHorizontal from '~icons/lucide/more-horizontal';
	import Plus from '~icons/lucide/plus';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Calendar from '~icons/nucleo/calendar';
	import CreditCard from '~icons/nucleo/credit-card';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import FolderOpen from '~icons/nucleo/folder-open';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Hash from '~icons/nucleo/hash';
	import Play from '~icons/nucleo/play';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import ShieldOff from '~icons/nucleo/shield-off';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';

	let { data }: { data: AdminPageData } = $props();
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	let search = $state('');
	let ownerFilter = $state('all');
	let billingFilter = $state('all');

	const ownerOptions = $derived(
		[
			...new Map(
				admin.adminProjects
					.filter((project) => project.ownerEmail)
					.map((project) => [project.ownerEmail!, project.ownerName ?? project.ownerEmail!])
			).entries()
		]
			.map(([email, name]) => ({ email, name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const ownerFilterLabel = $derived(
		ownerFilter === 'all'
			? 'All'
			: (ownerOptions.find((owner) => owner.email === ownerFilter)?.name ?? ownerFilter)
	);
	const billingFilterOptions = [
		{ value: 'exempt', label: 'Exempt' },
		{ value: 'configured', label: 'Configured' },
		{ value: 'past_due', label: 'Past due' },
		{ value: 'suspended', label: 'Suspended' },
		{ value: 'none', label: 'No billing' }
	] as const;
	const billingFilterLabel = $derived(
		billingFilterOptions.find((option) => option.value === billingFilter)?.label ?? 'All'
	);

	const filteredProjects = $derived(
		admin.adminProjects.filter((project) => {
			if (ownerFilter !== 'all' && project.ownerEmail !== ownerFilter) return false;
			if (billingFilter === 'exempt') {
				if (!project.billingExempt && !project.ownerBillingExempt) return false;
			} else if (billingFilter !== 'all' && project.billingStatus !== billingFilter) {
				return false;
			}
			const term = search.trim().toLowerCase();
			if (!term) return true;
			return [project.name, project.slug, project.ownerName, project.ownerEmail, project.id]
				.filter(Boolean)
				.some((value) => value!.toLowerCase().includes(term));
		})
	);

	const withVmsCount = $derived(admin.adminProjects.filter((p) => p.vmCount > 0).length);
	const billingConfiguredCount = $derived(
		admin.adminProjects.filter((p) => p.billingStatus !== 'none').length
	);
	const attentionCount = $derived(
		admin.adminProjects.filter(
			(p) => p.billingStatus === 'past_due' || p.billingStatus === 'suspended'
		).length
	);

	const projectsBase = resolve('/admin/projects');
	const selectedProject = $derived(
		page.params.id
			? (admin.adminProjects.find((project) => project.id === page.params.id) ?? null)
			: null
	);

	function openProjectSheet(project: AdminProject) {
		void goto(resolve(`/admin/projects/${project.id}`), {
			noScroll: true,
			keepFocus: true
		});
	}

	function closeProjectSheet() {
		void goto(projectsBase, { noScroll: true, keepFocus: true });
	}

	function projectVms(projectId: string) {
		return admin.adminVms.filter((vm) => vm.projectId === projectId && vm.active);
	}

	function vmStatusInfo(vm: AdminVm) {
		if (vm.status === 'deleting')
			return { label: 'deleting', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (vm.status === 'error')
			return { label: 'error', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (vm.status === 'provisioning')
			return { label: 'provisioning', class: 'border-sky-500/20 bg-sky-500/10 text-sky-400' };
		if (vm.liveStatus === 'running')
			return {
				label: 'running',
				class: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
			};
		if (vm.liveStatus === 'paused')
			return { label: 'paused', class: 'border-amber-500/20 bg-amber-500/10 text-amber-400' };
		return { label: 'stopped', class: 'border-ring/20 bg-muted/30 text-muted-foreground' };
	}

	function billingInfo(project: AdminProject) {
		if (project.billingStatus === 'suspended')
			return { label: 'suspended', class: 'border-red-500/20 bg-red-500/10 text-red-400' };
		if (project.billingStatus === 'past_due')
			return { label: 'past due', class: 'border-amber-500/20 bg-amber-500/10 text-amber-400' };
		if (project.billingStatus === 'configured')
			return {
				label: 'configured',
				class: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
			};
		return { label: 'no billing', class: 'border-ring/20 bg-muted/30 text-muted-foreground' };
	}

	function formatDate(timestamp: number) {
		return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(timestamp));
	}

	type DeletionVerificationMethod = 'passkey' | 'totp' | 'email';

	let createProjectOpen = $state(false);
	let createProjectName = $state('');
	let createProjectOwnerId = $state('');
	let createProjectOwnerSearch = $state('');
	let createProjectSaving = $state(false);
	let createProjectError = $state('');
	const createProjectOwners = $derived(
		[...admin.adminUsers]
			.sort((a, b) => a.name.localeCompare(b.name))
			.filter((account) => {
				const term = createProjectOwnerSearch.trim().toLowerCase();
				if (!term) return true;
				return [account.name, account.email].some((value) => value.toLowerCase().includes(term));
			})
	);

	function openCreateProject() {
		createProjectName = '';
		createProjectOwnerId = '';
		createProjectOwnerSearch = '';
		createProjectError = '';
		createProjectOpen = true;
	}

	async function submitCreateProject() {
		if (!createProjectName.trim() || !createProjectOwnerId || createProjectSaving) return;
		createProjectSaving = true;
		createProjectError = '';
		try {
			const created = await createAdminProject({
				name: createProjectName.trim(),
				ownerUserId: createProjectOwnerId
			});
			await invalidate('app:admin-projects');
			createProjectOpen = false;
			toast.success('Project created');
			void goto(resolve(`/admin/projects/${created.id}`), { noScroll: true, keepFocus: true });
		} catch (err) {
			createProjectError = getErrorMessage(err, 'Failed to create project');
		} finally {
			createProjectSaving = false;
		}
	}

	let createVmOpen = $state(false);
	let createVmProject = $state<AdminProject | null>(null);
	let createVmName = $state('');
	let createVmTypeId = $state('');
	let createVmImageId = $state('');
	let createVmNetworking = $state<'both' | 'ipv6'>('both');
	let createVmPassword = $state('');
	let createVmSshKeyIds = $state<string[]>([]);
	let createVmOwnerKeys = $state<UserSshKey[]>([]);
	let createVmOwnerKeysLoading = $state(false);
	let createVmSaving = $state(false);
	let createVmError = $state('');
	const createVmTypeLabel = $derived(
		admin.vmTypes.find((vmType) => vmType.id === createVmTypeId)?.name ?? 'Select a plan'
	);
	const createVmImageLabel = $derived.by(() => {
		const image = admin.images.find((item) => item.id === createVmImageId);
		return image ? `${image.name} ${image.version}`.trim() : 'No image';
	});

	function openCreateVm(project: AdminProject) {
		createVmProject = project;
		createVmName = generateServerName();
		createVmTypeId = admin.vmTypes[0]?.id ?? '';
		createVmImageId = admin.images[0]?.id ?? '';
		createVmNetworking = 'both';
		createVmPassword = '';
		createVmSshKeyIds = [];
		createVmOwnerKeys = [];
		createVmError = '';
		createVmOpen = true;
		if (project.ownerId) void loadOwnerSshKeys(project.ownerId);
	}

	async function loadOwnerSshKeys(ownerId: string) {
		createVmOwnerKeysLoading = true;
		try {
			const resources = await runQuery(getUserResources({ userId: ownerId }));
			createVmOwnerKeys = resources.sshKeys;
		} catch {
			createVmOwnerKeys = [];
		} finally {
			createVmOwnerKeysLoading = false;
		}
	}

	function toggleCreateVmSshKey(keyId: string) {
		createVmSshKeyIds = createVmSshKeyIds.includes(keyId)
			? createVmSshKeyIds.filter((id) => id !== keyId)
			: [...createVmSshKeyIds, keyId];
	}

	async function submitCreateVm() {
		if (!createVmProject || !createVmName.trim() || !createVmTypeId || createVmSaving) return;
		createVmSaving = true;
		createVmError = '';
		try {
			await createAdminVm({
				projectId: createVmProject.id,
				vmTypeId: createVmTypeId,
				name: createVmName.trim(),
				networkingMode: createVmNetworking,
				...(createVmImageId ? { imageId: createVmImageId } : {}),
				...(createVmSshKeyIds.length > 0 ? { sshKeyIds: createVmSshKeyIds } : {}),
				...(createVmPassword.trim() ? { password: createVmPassword.trim() } : {})
			});
			await Promise.all([invalidate('app:admin-vms'), invalidate('app:admin-projects')]);
			createVmOpen = false;
			toast.success('Server created');
		} catch (err) {
			createVmError = getErrorMessage(err, 'Failed to create server');
		} finally {
			createVmSaving = false;
		}
	}

	let disableSaving = $state(false);
	async function toggleProjectDisabled(project: AdminProject) {
		if (disableSaving) return;
		const disabling = !project.disabled;
		const ok = await confirmDestructive({
			title: disabling ? `Disable ${project.name}?` : `Enable ${project.name}?`,
			description: disabling
				? 'Members lose access to this project and no new servers can be created until it is enabled again. Running servers keep running.'
				: 'Members regain access to this project and provisioning is allowed again.',
			confirmLabel: disabling ? 'Disable project' : 'Enable project'
		});
		if (!ok) return;
		disableSaving = true;
		try {
			await setProjectDisabled({ projectId: project.id, disabled: disabling });
			await invalidate('app:admin-projects');
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to update project'));
		} finally {
			disableSaving = false;
		}
	}

	let deleteDialogOpen = $state(false);
	let deletePreparing = $state(false);
	let deleteVerifying = $state(false);
	let deleteError = $state('');
	let deleteProjectId = $state('');
	let deleteProjectName = $state('');
	let deleteVerificationMethod = $state<DeletionVerificationMethod>('email');
	let deleteVerificationEmail = $state('');
	let deleteVerificationCode = $state('');
	const normalizedDeleteVerificationCode = $derived(deleteVerificationCode.replace(/\D/g, ''));
	const deleteVerificationDescription = $derived.by(() => {
		if (deleteVerificationMethod === 'passkey') {
			return `Use your registered passkey to confirm permanently deleting ${deleteProjectName}.`;
		}

		if (deleteVerificationMethod === 'totp') {
			return `Enter a code from your authenticator app to confirm permanently deleting ${deleteProjectName}.`;
		}

		return `Enter the code sent to ${deleteVerificationEmail} to confirm permanently deleting ${deleteProjectName}.`;
	});
	const deleteVerificationDisabled = $derived(
		deleteVerifying ||
			deletePreparing ||
			!deleteProjectId ||
			(deleteVerificationMethod !== 'passkey' && normalizedDeleteVerificationCode.length !== 6)
	);

	function resetDeleteDialog() {
		deleteDialogOpen = false;
		deleteError = '';
		deleteProjectId = '';
		deleteProjectName = '';
		deleteVerificationMethod = 'email';
		deleteVerificationEmail = '';
		deleteVerificationCode = '';
	}

	async function openDeleteProject(project: AdminProject) {
		if (deletePreparing || deleteVerifying) return;

		const ok = await confirmDestructive({
			title: `Delete ${project.name}?`,
			description:
				'This deprovisions every server, deletes volumes, releases networking, records final usage, and cancels billing for this project.',
			confirmWord: project.name,
			confirmLabel: 'Continue'
		});
		if (!ok) return;

		deletePreparing = true;
		try {
			const result = await beginDeleteProject({ projectId: project.id });
			deleteProjectId = project.id;
			deleteProjectName = result.projectName;
			deleteVerificationMethod = result.method;
			deleteVerificationEmail = result.email;
			deleteVerificationCode = '';
			deleteError = '';
			deleteDialogOpen = true;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to prepare project deletion'));
		} finally {
			deletePreparing = false;
		}
	}

	async function confirmDeleteProject() {
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

			await deleteProjectWithVerification({
				projectId: deleteProjectId,
				method: deleteVerificationMethod,
				code: normalizedDeleteVerificationCode
			});
			resetDeleteDialog();
			closeProjectSheet();
			await Promise.all([invalidate('app:admin-projects'), invalidate('app:admin-vms')]);
			toast.success('Project deleted');
		} catch (err) {
			deleteError = getErrorMessage(err, 'Failed to delete project');
		} finally {
			deleteVerifying = false;
		}
	}

	let reversalOpen = $state(false);
	let reversalVm = $state<{ id: string; name: string; projectName: string | null } | null>(null);

	function openReversal(vm: AdminVm) {
		reversalVm = { id: vm.id, name: vm.name, projectName: vm.projectName };
		reversalOpen = true;
	}

	async function deleteVm(vm: AdminVm) {
		const ok = await confirmDestructive({
			title: `Delete ${vm.name}?`,
			description: `This deprovisions the server in Proxmox, releases its networking, and records final usage.`,
			confirmWord: vm.name,
			confirmLabel: 'Delete server'
		});
		if (!ok) return;
		try {
			await admin.adminVmDelete(vm.id);
		} catch {
			return;
		}
	}
</script>

<svelte:head>
	<title>Projects</title>
</svelte:head>

{#snippet projectDetail(project: AdminProject)}
	{@const vmsForProject = projectVms(project.id)}
	{@const billing = billingInfo(project)}
	<div class="flex flex-col gap-6">
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 flex-col gap-0.5">
				<span class="truncate text-base font-semibold text-foreground">{project.name}</span>
				<span class="truncate font-mono text-xs text-muted-foreground">{project.slug}</span>
			</div>
			<div class="flex shrink-0 items-center gap-1.5">
				{#if project.disabled}
					<span
						class="inline-flex items-center gap-1 rounded-sm border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
					>
						<PowerOff class="h-2.5 w-2.5" />disabled
					</span>
				{/if}
				{#if project.billingExempt}
					<span
						class="inline-flex items-center gap-1 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400"
					>
						<ShieldOff class="h-2.5 w-2.5" />exempt
					</span>
				{/if}
				<span
					class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {billing.class}"
				>
					{billing.label}
				</span>
			</div>
		</div>

		<div class="grid grid-cols-3 gap-2">
			<div class="flex flex-col gap-0.5 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5">
				<span class="text-sm font-semibold text-foreground">{project.memberCount}</span>
				<span class="text-[10px] text-muted-foreground">Members</span>
			</div>
			<div class="flex flex-col gap-0.5 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5">
				<span class="text-sm font-semibold text-foreground">{project.vmCount}</span>
				<span class="text-[10px] text-muted-foreground">VMs</span>
			</div>
			<div class="flex flex-col gap-0.5 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5">
				<span class="text-sm font-semibold text-foreground">{project.volumeCount}</span>
				<span class="text-[10px] text-muted-foreground">Volumes</span>
			</div>
		</div>

		<div class="flex flex-col gap-3">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Owner</span>
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-2">
					<User class="size-4 shrink-0 text-muted-foreground" />
					<div class="flex min-w-0 flex-col">
						{#if project.ownerId}
							<a
								class="truncate text-sm font-medium text-foreground hover:underline"
								href={resolve(`/admin/users/${project.ownerId}`)}
							>
								{project.ownerName ?? 'No owner'}
							</a>
						{:else}
							<span class="truncate text-sm font-medium text-foreground">No owner</span>
						{/if}
						<span class="truncate text-[11px] text-muted-foreground"
							>{project.ownerEmail ?? '-'}</span
						>
					</div>
				</div>
				{#if project.ownerBillingExempt}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400"
					>
						<ShieldOff class="h-2.5 w-2.5" />Billing exempt
					</span>
				{/if}
			</div>
			{#if project.ownerId}
				{@const ownerId = project.ownerId}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<CreditCard
							class="h-4 w-4 {project.ownerBillingExempt
								? 'text-violet-400'
								: 'text-muted-foreground'}"
						/>
						<div class="flex flex-col">
							<span class="text-sm font-medium text-foreground">Owner billing exempt</span>
							<span class="text-[11px] text-muted-foreground">
								{project.ownerBillingExempt
									? 'No usage is billed in any project they own'
									: 'Usage is metered and billed normally'}
							</span>
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if admin.userSheetSaving[ownerId]?.field === 'billingExempt' && admin.userSheetSaving[ownerId]?.saving}
							<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						{/if}
						<Switch
							bind:checked={
								() => project.ownerBillingExempt, (v) => admin.setUserBillingExempt(ownerId, v)
							}
						/>
					</div>
				</div>
			{/if}
		</div>

		<Separator class="bg-muted" />

		<div class="flex flex-col gap-3">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Billing</span
			>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<CreditCard
						class="h-4 w-4 {project.billingExempt ? 'text-violet-400' : 'text-muted-foreground'}"
					/>
					<div class="flex flex-col">
						<span class="text-sm font-medium text-foreground">Project billing exempt</span>
						<span class="text-[11px] text-muted-foreground">
							{project.billingExempt
								? 'Usage in this project is not metered or billed'
								: 'Usage in this project is metered and billed normally'}
						</span>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if admin.adminProjectSaving[project.id]}
						<Loader2 class="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					{/if}
					<Switch
						bind:checked={
							() => project.billingExempt, (v) => admin.setProjectBillingExempt(project.id, v)
						}
					/>
				</div>
			</div>
		</div>

		<Separator class="bg-muted" />

		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
					>Virtual machines</span
				>
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					disabled={project.disabled}
					onclick={() => openCreateVm(project)}
				>
					<Plus class="h-3 w-3" />
					Create VM
				</Button>
			</div>
			{#if vmsForProject.length === 0}
				<p class="text-xs text-muted-foreground">No active VMs in this project</p>
			{:else}
				<div class="flex flex-col divide-y divide-border/50 rounded-sm border border-border/60">
					{#each vmsForProject as vm (vm.id)}
						{@const info = vmStatusInfo(vm)}
						{@const saving = admin.adminVmSaving[vm.id]}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="flex min-w-0 flex-col gap-0.5">
								<a
									class="truncate text-xs font-medium text-foreground hover:underline"
									href={resolve(`/admin/vms/${vm.id}`)}
								>
									{vm.name}
								</a>
								<span class="truncate font-mono text-[10px] text-muted-foreground">
									{vm.vmTypeName ?? '-'} · {vm.lastKnownIpv4 ?? vm.lastKnownIpv6 ?? vm.id}
								</span>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<span
									class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {info.class}"
								>
									{info.label}
								</span>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger disabled={Boolean(saving)}>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
										>
											{#if saving}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<MoreHorizontal class="h-4 w-4" />
											{/if}
										</Button>
									</DropdownMenu.Trigger>
									<DropdownMenu.Content class="w-44 border-border bg-background" align="end">
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
											disabled={vm.liveStatus === 'running'}
											onSelect={() => admin.adminVmPower(vm.id, 'start')}
										>
											<Play class="size-4 text-emerald-400" />Start
										</DropdownMenu.Item>
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
											disabled={vm.liveStatus !== 'running'}
											onSelect={() => admin.adminVmPower(vm.id, 'stop')}
										>
											<Power class="size-4 text-muted-foreground" />Shut down
										</DropdownMenu.Item>
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
											disabled={vm.liveStatus !== 'running'}
											onSelect={() => admin.adminVmPower(vm.id, 'reboot')}
										>
											<RotateCw class="size-4 text-sky-400" />Reboot
										</DropdownMenu.Item>
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
											disabled={vm.liveStatus !== 'running'}
											onSelect={() => admin.adminVmPower(vm.id, 'kill')}
										>
											<PowerOff class="size-4 text-amber-400" />Force stop
										</DropdownMenu.Item>
										<DropdownMenu.Separator class="bg-muted" />
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
											onSelect={() => openReversal(vm)}
										>
											<CreditCard class="size-4 text-violet-400" />Reverse billing
										</DropdownMenu.Item>
										<DropdownMenu.Separator class="bg-muted" />
										<DropdownMenu.Item
											class="flex cursor-pointer items-center gap-2 text-xs text-red-400 data-[highlighted]:bg-red-500/10"
											onSelect={() => deleteVm(vm)}
										>
											<Trash2 class="size-4" />Delete
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<Separator class="bg-muted" />

		<div class="flex flex-col gap-2">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Details</span
			>
			<div class="flex items-center justify-between">
				<span class="flex items-center gap-2 text-xs text-muted-foreground">
					<Hash class="h-3 w-3" />Project ID
				</span>
				<span class="font-mono text-xs text-muted-foreground">{project.id}</span>
			</div>
			<div class="flex items-center justify-between">
				<span class="flex items-center gap-2 text-xs text-muted-foreground">
					<Calendar class="h-3 w-3" />Created
				</span>
				<span class="text-xs text-muted-foreground">{formatDate(project.createdAt)}</span>
			</div>
		</div>

		<Separator class="bg-muted" />

		<div class="flex flex-col gap-3 rounded-sm border border-red-500/20 bg-red-500/5 p-3">
			<div class="flex items-start gap-2">
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
				<div class="flex flex-col gap-1">
					<span class="text-sm font-medium text-red-300">Danger zone</span>
					<span class="text-[11px] leading-4 text-red-300/70">
						Disabling blocks all member access and stops new provisioning. Deleting deprovisions
						every VM and volume and cancels billing.
					</span>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					class="gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					disabled={disableSaving}
					onclick={() => toggleProjectDisabled(project)}
				>
					{#if disableSaving}
						<Loader2 class="h-3 w-3 animate-spin" />
					{:else if project.disabled}
						<Play class="h-3 w-3" />
					{:else}
						<PowerOff class="h-3 w-3" />
					{/if}
					{project.disabled ? 'Enable project' : 'Disable project'}
				</Button>
				<Button
					variant="destructive"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={deletePreparing || deleteVerifying}
					onclick={() => openDeleteProject(project)}
				>
					{#if deletePreparing}
						<Loader2 class="h-3 w-3 animate-spin" />
					{:else}
						<Trash2 class="h-3 w-3" />
					{/if}
					Delete project
				</Button>
			</div>
		</div>
	</div>
{/snippet}

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		{#if admin.adminVmError || admin.adminProjectError}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{admin.adminVmError || admin.adminProjectError}
			</div>
		{/if}

		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-base font-semibold tracking-tight text-foreground">Projects</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Manage user projects, their servers, and billing state.
				</p>
			</div>
			<Button size="sm" class="gap-1.5 text-xs" onclick={() => openCreateProject()}>
				<Plus class="h-3 w-3" />
				Create project
			</Button>
		</div>

		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10">
					<FolderOpen class="h-4 w-4 text-sky-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground"
						>{admin.adminProjects.length}</span
					>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Total projects</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10">
					<Server class="h-4 w-4 text-emerald-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{withVmsCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">With VMs</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
					<CreditCard class="h-4 w-4 text-violet-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground"
						>{billingConfiguredCount}</span
					>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Billing configured</span>
				</div>
			</div>
			<div
				class="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-4 py-3"
			>
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/10">
					<AlertTriangle class="h-4 w-4 text-red-400" />
				</div>
				<div class="flex flex-col">
					<span class="text-lg leading-none font-semibold text-foreground">{attentionCount}</span>
					<span class="mt-0.5 text-[10px] text-muted-foreground">Needs attention</span>
				</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative max-w-xs flex-1">
				<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={search}
					placeholder="Search by name, slug, owner..."
					class="h-8 pl-8 text-xs"
				/>
			</div>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1.5 border-border/50 text-xs {ownerFilter === 'all'
							? 'text-muted-foreground'
							: 'text-foreground'} hover:bg-muted hover:text-foreground"
					>
						Owner: {ownerFilterLabel}
						<ChevronDown class="h-3 w-3 text-muted-foreground" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="max-h-72 w-56 overflow-y-auto border-border bg-background">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
						onSelect={() => (ownerFilter = 'all')}
					>
						All owners
						{#if ownerFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-muted" />
					{#each ownerOptions as owner (owner.email)}
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (ownerFilter = owner.email)}
						>
							<span class="flex min-w-0 flex-col">
								<span class="truncate">{owner.name}</span>
								<span class="truncate text-[10px] text-muted-foreground">{owner.email}</span>
							</span>
							{#if ownerFilter === owner.email}
								<Check class="ml-auto h-3 w-3 shrink-0 text-emerald-400" />
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
						class="h-8 gap-1.5 border-border/50 text-xs {billingFilter === 'all'
							? 'text-muted-foreground'
							: 'text-foreground'} hover:bg-muted hover:text-foreground"
					>
						Billing: {billingFilterLabel}
						<ChevronDown class="h-3 w-3 text-muted-foreground" />
					</Button>
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-44 border-border bg-background">
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
						onSelect={() => (billingFilter = 'all')}
					>
						All billing states
						{#if billingFilter === 'all'}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="bg-muted" />
					{#each billingFilterOptions as option (option.value)}
						<DropdownMenu.Item
							class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
							onSelect={() => (billingFilter = option.value)}
						>
							{option.label}
							{#if billingFilter === option.value}
								<Check class="ml-auto h-3 w-3 text-emerald-400" />
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>

		{#if filteredProjects.length === 0}
			<div class="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
				<FolderOpen class="h-8 w-8 text-muted-foreground" />
				<p class="text-sm">No projects found</p>
			</div>
		{:else}
			<div class="overflow-x-auto rounded-md border border-border/60">
				<table class="w-full text-left text-xs">
					<thead>
						<tr
							class="border-b border-border/60 bg-background/40 text-[10px] tracking-wider text-muted-foreground uppercase"
						>
							<th class="px-4 py-2.5 font-medium">Project</th>
							<th class="px-4 py-2.5 font-medium">Owner</th>
							<th class="px-4 py-2.5 font-medium">Members</th>
							<th class="px-4 py-2.5 font-medium">Resources</th>
							<th class="px-4 py-2.5 font-medium">Billing</th>
							<th class="px-4 py-2.5 font-medium">Created</th>
							<th class="px-4 py-2.5"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/50">
						{#each filteredProjects as project (project.id)}
							{@const billing = billingInfo(project)}
							<tr
								class="cursor-pointer transition-colors hover:bg-muted/20"
								onclick={() => openProjectSheet(project)}
							>
								<td class="px-4 py-3">
									<div class="flex flex-col gap-0.5">
										<span class="font-medium text-foreground">{project.name}</span>
										<span class="font-mono text-[10px] text-muted-foreground">{project.slug}</span>
									</div>
								</td>
								<td class="px-4 py-3">
									<div class="flex flex-col gap-0.5">
										<span class="text-muted-foreground">{project.ownerName ?? '-'}</span>
										<span class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
											{project.ownerEmail ?? 'no owner'}
											{#if project.ownerBillingExempt}
												<span
													class="inline-flex items-center gap-0.5 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1 py-px font-medium text-violet-400"
												>
													<ShieldOff class="h-2.5 w-2.5" />No billing
												</span>
											{/if}
										</span>
									</div>
								</td>
								<td class="px-4 py-3 text-muted-foreground">{project.memberCount}</td>
								<td class="px-4 py-3">
									<div class="flex items-center gap-3 text-muted-foreground">
										<span class="flex items-center gap-1">
											<Server class="h-3 w-3" />{project.vmCount}
										</span>
										<span class="flex items-center gap-1">
											<HardDrive class="h-3 w-3" />{project.volumeCount}
										</span>
									</div>
								</td>
								<td class="px-4 py-3">
									<div class="flex items-center gap-1.5">
										{#if project.disabled}
											<span
												class="inline-flex items-center gap-1 rounded-sm border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
											>
												<PowerOff class="h-2.5 w-2.5" />disabled
											</span>
										{/if}
										{#if project.billingExempt}
											<span
												class="inline-flex items-center gap-1 rounded-sm border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400"
											>
												<ShieldOff class="h-2.5 w-2.5" />exempt
											</span>
										{/if}
										<span
											class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {billing.class}"
										>
											{billing.label}
										</span>
									</div>
								</td>
								<td class="px-4 py-3 text-muted-foreground">{formatDate(project.createdAt)}</td>
								<td class="px-4 py-3 text-right">
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

<Sheet.Root open={selectedProject !== null} onOpenChange={(value) => !value && closeProjectSheet()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if selectedProject}
			{@render projectDetail(selectedProject)}
		{/if}
	</Sheet.Content>
</Sheet.Root>

<VmBillingReversalDialog bind:open={reversalOpen} vm={reversalVm} />

<Dialog.Root bind:open={createProjectOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Create project</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				Creates a project owned by the selected user, with billing set up like a normal signup.
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-2"
			onsubmit={(event) => {
				event.preventDefault();
				void submitCreateProject();
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="admin-create-project-name">Project name</Label>
				<Input
					id="admin-create-project-name"
					bind:value={createProjectName}
					placeholder="Untitled Project"
					class="text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>Owner</Label>
				<Input
					bind:value={createProjectOwnerSearch}
					placeholder="Search by name or email..."
					class="h-8 text-xs"
				/>
				<div class="flex max-h-48 flex-col overflow-y-auto rounded-sm border border-border/60">
					{#each createProjectOwners as owner (owner.id)}
						<button
							type="button"
							class="flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 {createProjectOwnerId ===
							owner.id
								? 'bg-muted/30'
								: ''}"
							onclick={() => (createProjectOwnerId = owner.id)}
						>
							<span class="flex min-w-0 flex-col">
								<span class="truncate font-medium text-foreground">{owner.name}</span>
								<span class="truncate text-[10px] text-muted-foreground">{owner.email}</span>
							</span>
							{#if createProjectOwnerId === owner.id}
								<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							{/if}
						</button>
					{:else}
						<p class="px-3 py-4 text-center text-xs text-muted-foreground">No users found</p>
					{/each}
				</div>
			</div>

			{#if createProjectError}
				<p class="text-xs text-red-400">{createProjectError}</p>
			{/if}

			<Dialog.Footer class="flex items-center gap-2 pt-2">
				<Button
					variant="outline"
					type="button"
					size="sm"
					class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => (createProjectOpen = false)}
					disabled={createProjectSaving}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={createProjectSaving || !createProjectName.trim() || !createProjectOwnerId}
				>
					{#if createProjectSaving}
						<Loader2 class="h-3 w-3 animate-spin" />
						Creating...
					{:else}
						<Plus class="h-3 w-3" />
						Create project
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={createVmOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">
				Create server in {createVmProject?.name ?? 'project'}
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				Provisions a server in this project. Usage is billed to the project unless it is exempt.
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-2"
			onsubmit={(event) => {
				event.preventDefault();
				void submitCreateVm();
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for="admin-create-vm-name">Name</Label>
				<Input id="admin-create-vm-name" bind:value={createVmName} class="text-sm" />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<Label>Plan</Label>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							<Button
								variant="outline"
								size="sm"
								class="h-8 w-full justify-between gap-1.5 border-border/50 text-xs {createVmTypeId
									? 'text-foreground'
									: 'text-muted-foreground'}"
							>
								<span class="truncate">{createVmTypeLabel}</span>
								<ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="max-h-64 w-56 overflow-y-auto border-border bg-background">
							{#each admin.vmTypes as vmType (vmType.id)}
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
									onSelect={() => (createVmTypeId = vmType.id)}
								>
									<span class="flex min-w-0 flex-col">
										<span class="truncate">{vmType.name}</span>
										<span class="truncate text-[10px] text-muted-foreground">
											{vmType.cores}c · {vmType.ramCapacity} MB · {vmType.storageAmount} GB
										</span>
									</span>
									{#if createVmTypeId === vmType.id}
										<Check class="ml-auto h-3 w-3 shrink-0 text-emerald-400" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label>Image</Label>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							<Button
								variant="outline"
								size="sm"
								class="h-8 w-full justify-between gap-1.5 border-border/50 text-xs {createVmImageId
									? 'text-foreground'
									: 'text-muted-foreground'}"
							>
								<span class="truncate">{createVmImageLabel}</span>
								<ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
							</Button>
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="max-h-64 w-56 overflow-y-auto border-border bg-background">
							<DropdownMenu.Item
								class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
								onSelect={() => (createVmImageId = '')}
							>
								No image
								{#if !createVmImageId}<Check class="ml-auto h-3 w-3 text-emerald-400" />{/if}
							</DropdownMenu.Item>
							<DropdownMenu.Separator class="bg-muted" />
							{#each admin.images as image (image.id)}
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 text-xs text-foreground data-[highlighted]:bg-muted"
									onSelect={() => (createVmImageId = image.id)}
								>
									<span class="truncate">{image.name} {image.version}</span>
									{#if createVmImageId === image.id}
										<Check class="ml-auto h-3 w-3 shrink-0 text-emerald-400" />
									{/if}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>Networking</Label>
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						class="rounded-sm border px-3 py-2 text-left text-xs transition-colors {createVmNetworking ===
						'both'
							? 'border-ring/60 bg-muted/30 text-foreground'
							: 'border-border/60 text-muted-foreground hover:bg-muted/20'}"
						onclick={() => (createVmNetworking = 'both')}
					>
						IPv4 + IPv6
					</button>
					<button
						type="button"
						class="rounded-sm border px-3 py-2 text-left text-xs transition-colors {createVmNetworking ===
						'ipv6'
							? 'border-ring/60 bg-muted/30 text-foreground'
							: 'border-border/60 text-muted-foreground hover:bg-muted/20'}"
						onclick={() => (createVmNetworking = 'ipv6')}
					>
						IPv6 only
					</button>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="admin-create-vm-password">Root password</Label>
				<Input
					id="admin-create-vm-password"
					type="text"
					bind:value={createVmPassword}
					placeholder="Optional"
					autocomplete="off"
					class="text-sm"
				/>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label>Owner SSH keys</Label>
				{#if createVmOwnerKeysLoading}
					<p class="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 class="h-3 w-3 animate-spin" />Loading keys...
					</p>
				{:else if createVmOwnerKeys.length === 0}
					<p class="text-xs text-muted-foreground">The project owner has no SSH keys.</p>
				{:else}
					<div class="flex max-h-32 flex-col overflow-y-auto rounded-sm border border-border/60">
						{#each createVmOwnerKeys as key (key.id)}
							<button
								type="button"
								class="flex items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 {createVmSshKeyIds.includes(
									key.id
								)
									? 'bg-muted/30'
									: ''}"
								onclick={() => toggleCreateVmSshKey(key.id)}
							>
								<span class="flex min-w-0 flex-col">
									<span class="truncate font-medium text-foreground">{key.name}</span>
									<span class="truncate font-mono text-[10px] text-muted-foreground"
										>{key.fingerprint}</span
									>
								</span>
								{#if createVmSshKeyIds.includes(key.id)}
									<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			{#if createVmError}
				<p class="text-xs text-red-400">{createVmError}</p>
			{/if}

			<Dialog.Footer class="flex items-center gap-2 pt-2">
				<Button
					variant="outline"
					type="button"
					size="sm"
					class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => (createVmOpen = false)}
					disabled={createVmSaving}
				>
					Cancel
				</Button>
				<Button
					type="submit"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={createVmSaving || !createVmName.trim() || !createVmTypeId}
				>
					{#if createVmSaving}
						<Loader2 class="h-3 w-3 animate-spin" />
						Provisioning...
					{:else}
						<Plus class="h-3 w-3" />
						Create server
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	bind:open={deleteDialogOpen}
	onOpenChange={(value) => {
		if (!value && !deleteVerifying) resetDeleteDialog();
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">Delete {deleteProjectName}?</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				{deleteVerificationDescription}
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-4"
			onsubmit={(event) => {
				event.preventDefault();
				void confirmDeleteProject();
			}}
		>
			<div
				class="flex flex-col gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-200/80"
			>
				<p class="font-medium text-red-200">This action cannot be undone.</p>
				<p>
					Deleting {deleteProjectName} deprovisions every server, deletes volumes and invitations, records
					final usage, and cancels billing for this project.
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
						{deleteVerificationMethod === 'passkey' ? 'Verify and delete' : 'Delete project'}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
