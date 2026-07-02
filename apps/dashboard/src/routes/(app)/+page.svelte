<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		createProject as createProjectRpc,
		deleteProject as deleteProjectRpc
	} from '$lib/remote/projects.remote';
	import {
		Plus,
		FolderOpen,
		Settings,
		Trash2,
		MoreHorizontal,
		ArrowRight,
		Loader2
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';

	type Project = { id: string; projectName: string; role: string };

	let { data } = $props();
	let projects = $derived<Project[]>(data.projects ?? []);

	let createOpen = $state(false);
	let newProjectName = $state('');
	let creatingProject = $state(false);
	let createProjectError = $state('');

	let deleteOpen = $state(false);
	let deleteTarget = $state<Project | null>(null);
	let deleteConfirm = $state('');
	let deletingProject = $state(false);

	async function handleCreateProject() {
		if (!newProjectName.trim() || creatingProject) return;

		creatingProject = true;
		createProjectError = '';
		try {
			const name = newProjectName.trim();
			const res = await createProjectRpc({ name });
			projects = [...projects, { id: res.id, projectName: name, role: 'owner' }];
			newProjectName = '';
			createOpen = false;
			await authClient.organization.setActive({ organizationId: res.id });
			await goto(`/projects/${res.id}/servers`);
		} catch (err) {
			createProjectError = getErrorMessage(err, 'Project could not be created.');
		} finally {
			creatingProject = false;
		}
	}

	async function openProject(project: Project, path = 'servers') {
		await authClient.organization.setActive({ organizationId: project.id });
		await goto(`/projects/${project.id}/${path}`);
	}

	function openCreateDialog() {
		createProjectError = '';
		createOpen = true;
	}

	function closeCreateDialog() {
		if (creatingProject) return;

		createOpen = false;
		createProjectError = '';
	}

	async function handleDeleteProject() {
		if (!deleteTarget || deleteConfirm.trim() !== deleteTarget.projectName || deletingProject)
			return;

		deletingProject = true;
		const target = deleteTarget;
		try {
			await deleteProjectRpc({ projectId: target.id });
			await invalidate('app:projects');
			projects = projects.filter((p) => p.id !== target.id);
			deleteTarget = null;
			deleteConfirm = '';
			deleteOpen = false;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete project'));
		} finally {
			deletingProject = false;
		}
	}

	function openDeleteDialog(project: Project) {
		deleteTarget = project;
		deleteConfirm = '';
		deleteOpen = true;
	}

	function closeDeleteDialog() {
		if (deletingProject) return;

		deleteOpen = false;
		deleteTarget = null;
		deleteConfirm = '';
	}
</script>

<svelte:head>
	<title>Projects / Stack</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-auto bg-gray-950/30">
	<div class="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-8 sm:px-8 lg:px-10">
		{#if projects.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center text-center">
				<div
					class="mb-5 flex size-14 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900"
				>
					<FolderOpen class="size-7 text-gray-500" />
				</div>
				<h1 class="text-xl font-semibold tracking-tight text-balance text-gray-50">
					No projects yet
				</h1>
				<p class="mt-2 max-w-[52ch] text-sm text-pretty text-gray-500">
					Create your first project to organize servers, storage, networks, and access controls.
				</p>
				<Button
					variant="outline"
					size="sm"
					class="mt-6 gap-1.5 border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-gray-100"
					onclick={openCreateDialog}
				>
					<Plus class="size-3.5" />
					Create Project
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-8">
				<div>
					<div>
						<h1 class="text-3xl font-semibold tracking-tight text-balance text-gray-50">
							Projects
						</h1>
					</div>
				</div>

				<div class="overflow-hidden border border-gray-800 bg-gray-950/40">
					{#each projects as project (project.id)}
						<div class="group relative border-b border-gray-800/80 last:border-b-0">
							<button
								type="button"
								class="grid w-full gap-4 p-4 text-left transition-colors hover:bg-gray-900/70 sm:grid-cols-[1fr_auto] sm:items-center"
								onclick={() => openProject(project)}
							>
								<div class="flex min-w-0 items-center gap-4">
									<div
										class="flex size-10 shrink-0 items-center justify-center border border-gray-800 bg-gray-900 font-mono text-sm font-medium text-gray-300"
									>
										{project.projectName.slice(0, 2).toUpperCase()}
									</div>
									<div class="min-w-0">
										<h2 class="truncate text-base font-semibold text-gray-50">
											{project.projectName}
										</h2>
										<p class="mt-1 text-sm text-gray-500 capitalize">{project.role}</p>
									</div>
								</div>
								<div class="flex items-center gap-3 text-sm text-gray-500">
									<ArrowRight
										class="size-4 text-gray-500 transition-colors group-hover:text-red-300"
									/>
								</div>
							</button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									aria-label={`Actions for ${project.projectName}`}
									class="absolute top-1/2 right-4 flex size-8 -translate-y-1/2 items-center justify-center text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-800 hover:text-gray-300"
								>
									<MoreHorizontal class="size-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="w-44 border-gray-800 bg-gray-900">
									<DropdownMenu.Item
										class="gap-2 text-sm text-gray-300 focus:bg-gray-800 focus:text-gray-100"
										onclick={() => openProject(project, 'settings')}
									>
										<Settings class="size-3.5" />
										Project Settings
									</DropdownMenu.Item>
									<DropdownMenu.Separator class="bg-gray-800" />
									<DropdownMenu.Item
										class="gap-2 text-sm text-red-400 focus:bg-red-950/40 focus:text-red-300"
										onclick={() => openDeleteDialog(project)}
									>
										<Trash2 class="size-3.5" />
										Delete Project
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/each}
					<button
						class="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-gray-900/70"
						onclick={openCreateDialog}
					>
						<span
							class="flex size-10 shrink-0 items-center justify-center border border-dashed border-gray-800"
						>
							<Plus class="size-5 text-gray-500" />
						</span>
						<span>
							<span class="text-base font-medium text-gray-400">New Project</span>
							<span class="mt-1 block text-sm text-gray-500">Create a project</span>
						</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<Dialog.Root
	bind:open={createOpen}
	onOpenChange={(v) => {
		if (!v) closeCreateDialog();
	}}
>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Project</Dialog.Title>
			<Dialog.Description>
				Projects group your servers, volumes, and other resources.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Label>Project Name</Label>
			<Input
				bind:value={newProjectName}
				placeholder="my-project"
				disabled={creatingProject}
				onkeydown={(e) => e.key === 'Enter' && handleCreateProject()}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={closeCreateDialog} disabled={creatingProject}
				>Cancel</Button
			>
			<Button
				size="sm"
				onclick={handleCreateProject}
				disabled={!newProjectName.trim() || creatingProject}
			>
				{#if creatingProject}
					<Loader2 class="size-3.5 animate-spin" />
					Creating...
				{:else}
					Create
				{/if}
			</Button>
		</Dialog.Footer>
		{#if createProjectError}
			<p class="text-sm text-red-300">{createProjectError}</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	bind:open={deleteOpen}
	onOpenChange={(v) => {
		if (!v) closeDeleteDialog();
	}}
>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete Project</Dialog.Title>
			<Dialog.Description>
				This will permanently delete <strong>{deleteTarget?.projectName}</strong> and all its resources.
				Type the project name to confirm.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Input
				bind:value={deleteConfirm}
				placeholder={deleteTarget?.projectName ?? 'project name'}
				class="border-red-900/50"
				disabled={deletingProject}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={closeDeleteDialog} disabled={deletingProject}
				>Cancel</Button
			>
			<Button
				variant="destructive"
				size="sm"
				onclick={handleDeleteProject}
				disabled={deleteConfirm.trim() !== deleteTarget?.projectName || deletingProject}
			>
				{#if deletingProject}
					<Loader2 class="size-3.5 animate-spin" />
					Deleting...
				{:else}
					Delete Project
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
