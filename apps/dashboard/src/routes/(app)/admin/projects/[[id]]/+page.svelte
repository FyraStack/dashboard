<script lang="ts">
	import type { VerificationMethod } from 'stack-shared/auth';
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { IconComponent } from '#lib';
	import { ownerOptions } from '#lib/admin-users.js';
	import { describeDeletionVerification } from '#lib/admin-verification.js';
	import {
		AdminVmActions,
		adminVmStatusKey,
		describeAdminVmStatusKey
	} from '#lib/admin-vm-actions.svelte.js';
	import FilterMenu from '#lib/components/admin/filter-menu.svelte';
	import { adminMenuItemClass } from '#lib/components/admin/menu-item-class.js';
	import VmActionsMenu from '#lib/components/admin/vm-actions-menu.svelte';
	import VmBillingReversalDialog from '#lib/components/admin/vm-billing-reversal-dialog.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import VerificationDialog from '#lib/components/verification-dialog.svelte';
	import { confirmDestructive } from '#lib/confirm.svelte.js';
	import { dependencies } from '#lib/dependencies.js';
	import { formatDate } from '#lib/format.js';
	import { idempotent } from '#lib/idempotency.js';
	import { generateServerName } from '#lib/name-generator.js';
	import { runOptimistic } from '#lib/optimistic.js';
	import {
		type AdminProject,
		beginDeleteProject,
		createAdminProject,
		createAdminVm,
		deleteProjectWithVerification,
		setProjectBillingExempt,
		setProjectDisabled
	} from '#lib/remote/admin-projects.remote.js';
	import {
		getUserResources,
		setUserBillingExempt,
		type UserSshKey
	} from '#lib/remote/admin-users.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { type StatusTone, statusBadgeClass } from '#lib/vm-status.js';
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';
	import ChevronRight from '~icons/lucide/chevron-right';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Calendar from '~icons/nucleo/calendar';
	import CreditCard from '~icons/nucleo/credit-card';
	import FolderOpen from '~icons/nucleo/folder-open';
	import HardDrive from '~icons/nucleo/hard-drive';
	import Hash from '~icons/nucleo/hash';
	import Play from '~icons/nucleo/play';
	import PowerOff from '~icons/nucleo/power-off';
	import Search from '~icons/nucleo/search';
	import Server from '~icons/nucleo/server';
	import ShieldOff from '~icons/nucleo/shield-off';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';
	import type { PageProps } from './$types';

	const billingViews: Record<AdminProject['billingStatus'], { label: string; tone: StatusTone }> = {
		suspended: { label: 'suspended', tone: 'danger' },
		past_due: { label: 'past due', tone: 'warning' },
		configured: { label: 'configured', tone: 'success' },
		none: { label: 'no billing', tone: 'muted' }
	};
	const billingFilterOptions = [
		{ value: 'exempt', label: 'Exempt' },
		{ value: 'configured', label: 'Configured' },
		{ value: 'past_due', label: 'Past due' },
		{ value: 'suspended', label: 'Suspended' },
		{ value: 'none', label: 'No billing' }
	] as const;

	let { data }: PageProps = $props();

	const actions = new AdminVmActions();

	let projects = $derived<AdminProject[]>(data.adminProjects);
	let errorMessage = $state('');
	let projectExemptSaving = $state<Record<string, boolean>>({});
	let ownerExemptSaving = $state<Record<string, boolean>>({});

	let search = $state('');
	let ownerFilter = $state('all');
	let billingFilter = $state<'all' | AdminProject['billingStatus'] | 'exempt'>('all');

	let createProjectOpen = $state(false);
	let createProjectName = $state('');
	let createProjectOwnerId = $state('');
	let createProjectOwnerSearch = $state('');
	let createProjectSaving = $state(false);
	let createProjectError = $state('');

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

	let disableSaving = $state(false);

	let deletePreparing = $state(false);
	let deleteOpen = $state(false);
	let deletion = $state<{
		id: string;
		name: string;
		method: VerificationMethod;
		verificationEmail: string;
	} | null>(null);

	const projectsBase = resolve('admin/projects');
	const selectedProject = $derived(
		page.params.id ? (projects.find((project) => project.id === page.params.id) ?? null) : null
	);
	const ownerFilterOptions = $derived(
		ownerOptions(projects).map((owner) => ({
			value: owner.email,
			label: owner.name,
			detail: owner.email
		}))
	);
	const filteredProjects = $derived(
		projects.filter((project) => {
			if (ownerFilter !== 'all' && project.ownerEmail !== ownerFilter) {
				return false;
			}
			if (billingFilter === 'exempt') {
				if (!(project.billingExempt || project.ownerBillingExempt)) {
					return false;
				}
			} else if (billingFilter !== 'all' && project.billingStatus !== billingFilter) {
				return false;
			}
			const term = search.trim().toLowerCase();
			if (!term) {
				return true;
			}

			return [project.name, project.slug, project.ownerName, project.ownerEmail, project.id].some(
				(value) => value?.toLowerCase().includes(term)
			);
		})
	);
	const withVmsCount = $derived(projects.filter((p) => p.vmCount > 0).length);
	const billingConfiguredCount = $derived(
		projects.filter((p) => p.billingStatus !== 'none').length
	);
	const attentionCount = $derived(
		projects.filter((p) => p.billingStatus === 'past_due' || p.billingStatus === 'suspended').length
	);
	const createProjectOwners = $derived(
		[...data.adminUsers]
			.sort((a, b) => a.name.localeCompare(b.name))
			.filter((account) => {
				const term = createProjectOwnerSearch.trim().toLowerCase();
				if (!term) {
					return true;
				}
				return [account.name, account.email].some((value) => value.toLowerCase().includes(term));
			})
	);
	const createVmTypeLabel = $derived(
		data.vmTypes.find((vmType) => vmType.id === createVmTypeId)?.name ?? 'Select a plan'
	);
	const createVmImageLabel = $derived.by(() => {
		const image = data.images.find((item) => item.id === createVmImageId);
		return image ? `${image.name} ${image.version}`.trim() : 'No image';
	});

	function openProjectSheet(project: AdminProject) {
		goto(resolve(`admin/projects/${project.id}`), { reset: false });
	}

	function closeProjectSheet() {
		goto(projectsBase, { reset: false });
	}

	function projectVms(projectId: string) {
		return data.adminVms.filter((vm) => vm.projectId === projectId && vm.active);
	}

	async function updateProjects(
		patch: (project: AdminProject) => AdminProject,
		commit: () => Promise<unknown>,
		invalidates: string[],
		failureMessage: string
	) {
		errorMessage = '';
		try {
			await runOptimistic({
				apply: () => {
					const previous = projects;
					projects = projects.map(patch);
					return () => {
						projects = previous;
					};
				},
				commit,
				invalidates
			});
		} catch (err) {
			errorMessage = getErrorMessage(err, failureMessage);
		}
	}

	async function changeProjectBillingExempt(projectId: string, billingExempt: boolean) {
		projectExemptSaving[projectId] = true;
		await updateProjects(
			(project) => (project.id === projectId ? { ...project, billingExempt } : project),
			() => setProjectBillingExempt({ projectId, billingExempt }),
			[dependencies.admin.projects],
			'Failed to update billing exemption'
		);
		delete projectExemptSaving[projectId];
	}

	async function changeOwnerBillingExempt(userId: string, billingExempt: boolean) {
		ownerExemptSaving[userId] = true;
		await updateProjects(
			(project) =>
				project.ownerId === userId ? { ...project, ownerBillingExempt: billingExempt } : project,
			() => setUserBillingExempt({ userId, billingExempt }),
			[dependencies.admin.users, dependencies.admin.projects],
			'Failed to update billing exemption'
		);
		delete ownerExemptSaving[userId];
	}

	function openCreateProject() {
		createProjectName = '';
		createProjectOwnerId = '';
		createProjectOwnerSearch = '';
		createProjectError = '';
		createProjectOpen = true;
	}

	async function submitCreateProject() {
		if (!(createProjectName.trim() && createProjectOwnerId) || createProjectSaving) {
			return;
		}
		createProjectSaving = true;
		createProjectError = '';
		try {
			const payload = { name: createProjectName.trim(), ownerUserId: createProjectOwnerId };
			const created = await idempotent(createAdminProject, 'admin.createProject', payload);
			await invalidate(dependencies.admin.projects);
			createProjectOpen = false;
			toast.success('Project created');
			goto(resolve(`admin/projects/${created.id}`), { reset: false });
		} catch (err) {
			createProjectError = getErrorMessage(err, 'Failed to create project');
		} finally {
			createProjectSaving = false;
		}
	}

	function openCreateVm(project: AdminProject) {
		createVmProject = project;
		createVmName = generateServerName();
		createVmTypeId = data.vmTypes[0]?.id ?? '';
		createVmImageId = data.images[0]?.id ?? '';
		createVmNetworking = 'both';
		createVmPassword = '';
		createVmSshKeyIds = [];
		createVmOwnerKeys = [];
		createVmError = '';
		createVmOpen = true;
		if (project.ownerId) {
			loadOwnerSshKeys(project.ownerId);
		}
	}

	async function loadOwnerSshKeys(ownerId: string) {
		createVmOwnerKeysLoading = true;
		try {
			const resourcesQuery = getUserResources({ userId: ownerId });
			await resourcesQuery.refresh();
			const resources = await resourcesQuery;
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
		if (!(createVmProject && createVmName.trim() && createVmTypeId) || createVmSaving) {
			return;
		}
		createVmSaving = true;
		createVmError = '';
		try {
			const payload = {
				projectId: createVmProject.id,
				vmTypeId: createVmTypeId,
				name: createVmName.trim(),
				networkingMode: createVmNetworking,
				...(createVmImageId ? { imageId: createVmImageId } : {}),
				...(createVmSshKeyIds.length > 0 ? { sshKeyIds: [...createVmSshKeyIds].sort() } : {}),
				...(createVmPassword.trim() ? { password: createVmPassword.trim() } : {})
			};
			await idempotent(createAdminVm, 'admin.createVm', payload);
			await Promise.all([
				invalidate(dependencies.admin.vms),
				invalidate(dependencies.admin.projects)
			]);
			createVmOpen = false;
			toast.success('Server created');
		} catch (err) {
			createVmError = getErrorMessage(err, 'Failed to create server');
		} finally {
			createVmSaving = false;
		}
	}

	async function toggleProjectDisabled(project: AdminProject) {
		if (disableSaving) {
			return;
		}
		const disabling = !project.disabled;
		const ok = await confirmDestructive({
			title: disabling ? `Disable ${project.name}?` : `Enable ${project.name}?`,
			description: disabling
				? 'Members lose access to this project and no new servers can be created until it is enabled again. Running servers keep running.'
				: 'Members regain access to this project and provisioning is allowed again.',
			confirmLabel: disabling ? 'Disable project' : 'Enable project'
		});
		if (!ok) {
			return;
		}
		disableSaving = true;
		try {
			await setProjectDisabled({ projectId: project.id, disabled: disabling });
			await invalidate(dependencies.admin.projects);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to update project'));
		} finally {
			disableSaving = false;
		}
	}

	async function beginDelete(project: AdminProject) {
		if (deletePreparing) {
			return;
		}

		const ok = await confirmDestructive({
			title: `Delete ${project.name}?`,
			description:
				'This deprovisions every server, deletes volumes, releases networking, records final usage, and cancels billing for this project.',
			confirmWord: project.name,
			confirmLabel: 'Continue'
		});
		if (!ok) {
			return;
		}

		deletePreparing = true;
		try {
			const result = await beginDeleteProject({ projectId: project.id });
			deletion = {
				id: project.id,
				name: result.projectName,
				method: result.method,
				verificationEmail: result.email
			};
			deleteOpen = true;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to prepare project deletion'));
		} finally {
			deletePreparing = false;
		}
	}

	async function confirmDelete(code: string) {
		if (!deletion) {
			return;
		}
		await deleteProjectWithVerification({
			projectId: deletion.id,
			method: deletion.method,
			code
		});
		closeProjectSheet();
		await Promise.all([
			invalidate(dependencies.admin.projects),
			invalidate(dependencies.admin.vms)
		]);
		toast.success('Project deleted');
	}
</script>

<svelte:head>
	<title>Projects</title>
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

{#snippet sectionTitle(
	title: string
)}
	<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</span>
{/snippet}

{#snippet projectTags(
	project: AdminProject
)}
	{@const billing = billingViews[project.billingStatus]}
	{#if project.disabled}
		<span
			class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass.danger}"
		>
			<PowerOff class="h-2.5 w-2.5" />disabled
		</span>
	{/if}
	{#if project.billingExempt}
		<span
			class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass.accent}"
		>
			<ShieldOff class="h-2.5 w-2.5" />exempt
		</span>
	{/if}
	<span
		class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass[
			billing.tone
		]}"
	>
		{billing.label}
	</span>
{/snippet}

{#snippet switchRow(
	Icon: IconComponent,
	active: boolean,
	title: string,
	description: string,
	isSaving: boolean,
	toggle: Snippet
)}
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Icon class="h-4 w-4 {active ? 'text-violet-400' : 'text-muted-foreground'}" />
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
		{#if actions.error || errorMessage}
			<div
				class="flex items-center gap-2 rounded-md border border-red-300 bg-red-100 px-3 py-2 text-xs text-red-800 dark:border-red-800/50 dark:bg-red-950/50 dark:text-red-400"
			>
				<AlertTriangle class="size-4 shrink-0" />
				{actions.error || errorMessage}
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
			{@render statCard(
				FolderOpen,
				'bg-sky-500/10',
				'text-sky-400',
				projects.length,
				'Total projects'
			)}
			{@render statCard(Server, 'bg-emerald-500/10', 'text-emerald-400', withVmsCount, 'With VMs')}
			{@render statCard(
				CreditCard,
				'bg-violet-500/10',
				'text-violet-400',
				billingConfiguredCount,
				'Billing configured'
			)}
			{@render statCard(
				AlertTriangle,
				'bg-red-500/10',
				'text-red-400',
				attentionCount,
				'Needs attention'
			)}
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
			<FilterMenu
				label="Owner"
				allLabel="All owners"
				options={ownerFilterOptions}
				bind:value={ownerFilter}
				contentClass="max-h-72 w-56 overflow-y-auto"
			/>
			<FilterMenu
				label="Billing"
				allLabel="All billing states"
				options={billingFilterOptions}
				bind:value={billingFilter}
			/>
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
							<th class="px-4 py-2.5">
								<span class="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/50">
						{#each filteredProjects as project (project.id)}
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
													class="inline-flex items-center gap-0.5 rounded-sm border px-1 py-px font-medium {statusBadgeClass.accent}"
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
									<div class="flex items-center gap-1.5">{@render projectTags(project)}</div>
								</td>
								<td class="px-4 py-3 text-muted-foreground">{formatDate(project.createdAt)}</td>
								<td class="px-4 py-3 text-right">
									<button
										type="button"
										class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										aria-label="Open {project.name}"
										onclick={(event) => {
											event.stopPropagation();
											openProjectSheet(project);
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

<Sheet.Root open={selectedProject !== null} onOpenChange={(value) => !value && closeProjectSheet()}>
	<Sheet.Content side="right" class="w-full border-border bg-background p-6 sm:max-w-md">
		{#if selectedProject}
			{@const project = selectedProject}
			<div class="flex flex-col gap-6">
				<div class="flex items-start justify-between gap-3">
					<div class="flex min-w-0 flex-col gap-0.5">
						<span class="truncate text-base font-semibold text-foreground">{project.name}</span>
						<span class="truncate font-mono text-xs text-muted-foreground">{project.slug}</span>
					</div>
					<div class="flex shrink-0 items-center gap-1.5">{@render projectTags(project)}</div>
				</div>

				<div class="grid grid-cols-3 gap-2">
					{#each [
						{ value: project.memberCount, label: 'Members' },
						{ value: project.vmCount, label: 'VMs' },
						{ value: project.volumeCount, label: 'Volumes' }
					] as stat (stat.label)}
						<div
							class="flex flex-col gap-0.5 rounded-sm border border-border/60 bg-muted/20 px-3 py-2.5"
						>
							<span class="text-sm font-semibold text-foreground">{stat.value}</span>
							<span class="text-[10px] text-muted-foreground">{stat.label}</span>
						</div>
					{/each}
				</div>

				<div class="flex flex-col gap-3">
					{@render sectionTitle('Owner')}
					<div class="flex items-center justify-between gap-3">
						<div class="flex min-w-0 items-center gap-2">
							<User class="size-4 shrink-0 text-muted-foreground" />
							<div class="flex min-w-0 flex-col">
								{#if project.ownerId}
									<a
										class="truncate text-sm font-medium text-foreground hover:underline"
										href={resolve(`admin/users/${project.ownerId}`)}
										>{project.ownerName ?? 'No owner'}</a
									>
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
								class="inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass.accent}"
							>
								<ShieldOff class="h-2.5 w-2.5" />Billing exempt
							</span>
						{/if}
					</div>
					{#if project.ownerId}
						{@const ownerId = project.ownerId}
						{#snippet ownerExemptSwitch()}
							<Switch
								bind:checked={
									() => project.ownerBillingExempt,
									(value) => changeOwnerBillingExempt(ownerId, value)
								}
							/>
						{/snippet}
						{@render switchRow(
							CreditCard,
							project.ownerBillingExempt,
							'Owner billing exempt',
							project.ownerBillingExempt
								? 'No usage is billed in any project they own'
								: 'Usage is metered and billed normally',
							Boolean(ownerExemptSaving[ownerId]),
							ownerExemptSwitch
						)}
					{/if}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3">
					{@render sectionTitle('Billing')}
					{#snippet projectExemptSwitch()}
						<Switch
							bind:checked={
								() => project.billingExempt,
								(value) => changeProjectBillingExempt(project.id, value)
							}
						/>
					{/snippet}
					{@render switchRow(
						CreditCard,
						project.billingExempt,
						'Project billing exempt',
						project.billingExempt
							? 'Usage in this project is not metered or billed'
							: 'Usage in this project is metered and billed normally',
						Boolean(projectExemptSaving[project.id]),
						projectExemptSwitch
					)}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-3">
					<div class="flex items-center justify-between">
						{@render sectionTitle('Virtual machines')}
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
					{#each [projectVms(project.id)] as vmsForProject}
						{#if vmsForProject.length === 0}
							<p class="text-xs text-muted-foreground">No active VMs in this project</p>
						{:else}
							<div
								class="flex flex-col divide-y divide-border/50 rounded-sm border border-border/60"
							>
								{#each vmsForProject as vm (vm.id)}
									{@const view = describeAdminVmStatusKey(adminVmStatusKey(vm))}
									<div class="flex items-center justify-between gap-3 px-3 py-2.5">
										<div class="flex min-w-0 flex-col gap-0.5">
											<a
												class="truncate text-xs font-medium text-foreground hover:underline"
												href={resolve(`admin/vms/${vm.id}`)}
												>{vm.name}</a
											>
											<span class="truncate font-mono text-[10px] text-muted-foreground"
												>{vm.vmTypeName ?? '-'}
												· {vm.lastKnownIpv4 ?? vm.lastKnownIpv6 ?? vm.id}</span
											>
										</div>
										<div class="flex shrink-0 items-center gap-2">
											<span
												class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium {statusBadgeClass[
													view.tone
												]}"
											>
												{view.label}
											</span>
											<VmActionsMenu {vm} {actions} />
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{/each}
				</div>

				<Separator class="bg-muted" />

				<div class="flex flex-col gap-2">
					{@render sectionTitle('Details')}
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
							disabled={deletePreparing}
							onclick={() => beginDelete(project)}
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
		{/if}
	</Sheet.Content>
</Sheet.Root>

<VmBillingReversalDialog bind:open={actions.reversalOpen} vm={actions.reversalVm} />

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
				submitCreateProject();
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
				submitCreateVm();
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
						<DropdownMenu.Trigger
							class="flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-border/50 px-3 text-xs transition-colors hover:bg-muted hover:text-foreground {createVmTypeId
								? 'text-foreground'
								: 'text-muted-foreground'}"
						>
							<span class="truncate">{createVmTypeLabel}</span>
							<ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="max-h-64 w-56 overflow-y-auto border-border bg-background">
							{#each data.vmTypes as vmType (vmType.id)}
								<DropdownMenu.Item
									class={adminMenuItemClass}
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
						<DropdownMenu.Trigger
							class="flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-border/50 px-3 text-xs transition-colors hover:bg-muted hover:text-foreground {createVmImageId
								? 'text-foreground'
								: 'text-muted-foreground'}"
						>
							<span class="truncate">{createVmImageLabel}</span>
							<ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="max-h-64 w-56 overflow-y-auto border-border bg-background">
							<DropdownMenu.Item class={adminMenuItemClass} onSelect={() => (createVmImageId = '')}>
								No image
								{#if !createVmImageId}
									<Check class="ml-auto h-3 w-3 text-emerald-400" />
								{/if}
							</DropdownMenu.Item>
							<DropdownMenu.Separator class="bg-muted" />
							{#each data.images as image (image.id)}
								<DropdownMenu.Item
									class={adminMenuItemClass}
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
					{#each [
						{ value: 'both', label: 'IPv4 + IPv6' },
						{ value: 'ipv6', label: 'IPv6 only' }
					] as const as option (option.value)}
						<button
							type="button"
							class="rounded-sm border px-3 py-2 text-left text-xs transition-colors {createVmNetworking ===
							option.value
								? 'border-ring/60 bg-muted/30 text-foreground'
								: 'border-border/60 text-muted-foreground hover:bg-muted/20'}"
							onclick={() => (createVmNetworking = option.value)}
						>
							{option.label}
						</button>
					{/each}
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

{#if deletion}
	<VerificationDialog
		bind:open={deleteOpen}
		method={deletion.method}
		title="Delete {deletion.name}?"
		description={describeDeletionVerification(
			deletion.method,
			deletion.name,
			deletion.verificationEmail
		)}
		emailHint="We sent a deletion code to {deletion.verificationEmail}."
		destructive
		submitLabel="Delete project"
		passkeySubmitLabel="Verify and delete"
		submittingLabel="Deleting..."
		failureMessage="Failed to delete project"
		confirm={confirmDelete}
	>
		<div
			class="flex flex-col gap-2 rounded-sm border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-200/80"
		>
			<p class="font-medium text-red-200">This action cannot be undone.</p>
			<p>
				Deleting {deletion.name} deprovisions every server, deletes volumes and invitations, records
				final usage, and cancels billing for this project.
			</p>
		</div>
	</VerificationDialog>
{/if}
