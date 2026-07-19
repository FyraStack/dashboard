<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		updateProject as updateProjectRpc,
		deleteProject as deleteProjectRpc,
		addMember as addMemberRpc,
		updateMemberRole as updateMemberRoleRpc,
		removeMember as removeMemberRpc
	} from '$lib/remote/projects.remote';
	import Check from '~icons/lucide/check';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import Settings from '~icons/nucleo/settings';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';
	import { projectRoleLabels } from '$lib/auth/organization-permissions';

	let { data } = $props();

	type ProjectRole = 'owner' | 'admin' | 'read_write' | 'read';
	type MemberRole = Exclude<ProjectRole, 'owner'>;
	type ProjectMember = { userId: string; name: string; email: string; permissions: ProjectRole };

	let projectName = $derived(data.project.projectName);
	let projectOwnerId = $derived(data.project.ownerUserId);
	let projectOwnerName = $derived(data.project.ownerName);
	let projectOwnerEmail = $derived(data.project.ownerEmail);
	let members = $derived<ProjectMember[]>([...data.project.members]);
	let saving = $state(false);
	let saved = $state(false);
	let savedTimeout: ReturnType<typeof setTimeout> | undefined;

	// Delete
	let deleteConfirm = $state('');
	let deleting = $state(false);

	// Add member
	let addMemberOpen = $state(false);
	let memberInviteEmail = $state('');
	let selectedMemberRole = $state<MemberRole>('read_write');
	let addingMember = $state(false);
	let memberToRemove = $state<ProjectMember | null>(null);
	let removingMemberIds = $state<string[]>([]);
	let updatingMemberIds = $state<string[]>([]);

	let projectId = $derived(data.project.id);

	const viewerRole = $derived(data.viewerRole as ProjectRole);
	const isOwner = $derived(viewerRole === 'owner');
	const canManageMembers = $derived(viewerRole === 'owner' || viewerRole === 'admin');
	const currentUserId = $derived(data.user?.id);

	const roleLabels = projectRoleLabels;

	const memberRoleOptions: { value: MemberRole; description: string }[] = [
		{ value: 'admin', description: 'Manage members, project settings, and all resources' },
		{ value: 'read_write', description: 'Create and modify resources' },
		{ value: 'read', description: 'View resources only' }
	];

	$effect(() => {
		return clearSavedTimeout;
	});

	function clearSavedTimeout() {
		if (!savedTimeout) return;
		clearTimeout(savedTimeout);
		savedTimeout = undefined;
	}

	async function saveName() {
		if (saving || !projectId) return;
		saving = true;
		saved = false;
		try {
			await updateProjectRpc({ projectId, name: projectName.trim() });
			await invalidate('app:projects');
			saved = true;
			clearSavedTimeout();
			savedTimeout = setTimeout(() => {
				saved = false;
				savedTimeout = undefined;
			}, 1500);
		} catch (e) {
			toast.error(getErrorMessage(e, 'Failed to update project name'));
		} finally {
			saving = false;
		}
	}

	async function deleteProject() {
		if (deleting || !projectId) return;
		deleting = true;
		try {
			await deleteProjectRpc({ projectId });
			await goto(resolve('/'));
		} catch (e) {
			toast.error(getErrorMessage(e, 'Failed to delete project'));
		} finally {
			deleting = false;
		}
	}

	async function addMember() {
		if (!projectId || addingMember || !memberInviteEmail.trim()) return;
		addingMember = true;
		const email = memberInviteEmail.trim();
		try {
			await addMemberRpc({
				projectId,
				email,
				permissions: selectedMemberRole
			});
			memberInviteEmail = '';
			selectedMemberRole = 'read_write';
			addMemberOpen = false;
			toast.success(`Invitation sent to ${email}`);
			await invalidate('app:projects');
		} catch (e) {
			toast.error(getErrorMessage(e, 'Failed to add member'));
		} finally {
			addingMember = false;
		}
	}

	function confirmRemoveMember() {
		if (!memberToRemove) return;
		const userId = memberToRemove.userId;
		memberToRemove = null;
		removeMember(userId);
	}

	async function removeMember(userId: string) {
		if (!projectId || removingMemberIds.includes(userId)) return;
		const idx = members.findIndex((m) => m.userId === userId);
		if (idx === -1) return;
		const removed = members[idx];
		removingMemberIds = [...removingMemberIds, userId];
		members = members.filter((m) => m.userId !== userId);
		try {
			await removeMemberRpc({ projectId, userId });
		} catch (e) {
			members = [...members.slice(0, idx), removed, ...members.slice(idx)];
			toast.error(getErrorMessage(e, 'Failed to remove member'));
		} finally {
			removingMemberIds = removingMemberIds.filter((id) => id !== userId);
		}
	}

	async function updateMemberRole(userId: string, newRole: MemberRole) {
		if (!projectId || updatingMemberIds.includes(userId)) return;
		const idx = members.findIndex((m) => m.userId === userId);
		if (idx === -1) return;
		if (members[idx].permissions === newRole) return;
		const oldRole = members[idx].permissions;
		updatingMemberIds = [...updatingMemberIds, userId];
		members = members.map((member) =>
			member.userId === userId ? { ...member, permissions: newRole } : member
		);
		try {
			await updateMemberRoleRpc({ projectId, userId, permissions: newRole });
		} catch (e) {
			members = members.map((member) =>
				member.userId === userId ? { ...member, permissions: oldRole } : member
			);
			toast.error(getErrorMessage(e, 'Failed to update member role'));
		} finally {
			updatingMemberIds = updatingMemberIds.filter((id) => id !== userId);
		}
	}
</script>

<svelte:head>
	<title>Project Settings / Stack</title>
</svelte:head>

<div class="flex h-full w-full flex-col overflow-hidden">
	<div class="flex-1 overflow-auto">
		<div class="max-w-2xl px-6 py-6">
			<h1 class="sr-only">Project Settings</h1>
			<div class="flex flex-col gap-6">
				<!-- Project Name -->
				<div class="rounded-xs border border-border/60 p-5">
					<div class="mb-4 flex items-center gap-2 border-b border-border/50 pb-3">
						<Settings class="h-4 w-4 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
							Project Name
						</p>
					</div>
					<div class="flex flex-col gap-3">
						<Input
							bind:value={projectName}
							aria-label="Project name"
							class="font-medium"
							disabled={!canManageMembers}
						/>
						<Button
							size="sm"
							onclick={saveName}
							disabled={saving || !canManageMembers}
							class="w-fit"
						>
							{#if saving}
								<Loader2 class="h-3 w-3 animate-spin" />
								Saving...
							{:else if saved}
								<Check class="h-3 w-3" /> Saved
							{:else}
								Save Name
							{/if}
						</Button>
					</div>
				</div>

				<!-- Members -->
				<div class="rounded-xs border border-border/60 p-5">
					<div class="mb-4 flex items-center justify-between border-b border-border/50 pb-3">
						<div class="flex items-center gap-2">
							<User class="h-4 w-4 text-red-400" />
							<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
								Members
							</p>
						</div>
						{#if canManageMembers}
							<Button
								variant="outline"
								size="sm"
								class="h-7 gap-1.5 text-xs"
								onclick={() => (addMemberOpen = true)}
							>
								<Plus class="h-3 w-3" />
								Add
							</Button>
						{/if}
					</div>
					<div class="max-h-48 overflow-y-auto">
						<!-- Owner -->
						<div class="flex items-center justify-between py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-foreground">{projectOwnerName}</p>
								<p class="truncate text-xs text-muted-foreground">{projectOwnerEmail}</p>
							</div>
							<Badge variant="secondary" class="shrink-0 text-[10px]">Owner</Badge>
						</div>
						<div class="border-b border-border/30"></div>
						<!-- Other members -->
						{#each members as member (member.userId)}
							<div class="flex items-center justify-between gap-3 py-2.5">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-foreground">{member.name}</p>
									<p class="truncate text-xs text-muted-foreground">{member.email}</p>
								</div>
								<div class="flex shrink-0 items-center gap-1.5">
									{#if canManageMembers && member.userId !== currentUserId}
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
											aria-label={`Remove ${member.name}`}
											onclick={() => (memberToRemove = member)}
											disabled={removingMemberIds.includes(member.userId) ||
												updatingMemberIds.includes(member.userId)}
										>
											{#if removingMemberIds.includes(member.userId)}
												<Loader2 class="h-3.5 w-3.5 animate-spin" />
											{:else}
												<Trash2 class="size-4" />
											{/if}
										</Button>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger class="flex cursor-pointer items-center">
												<Badge
													variant="secondary"
													class="text-[10px] transition-colors hover:bg-muted"
													>{roleLabels[member.permissions]}</Badge
												>
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end" class="border-border bg-background">
												{#each memberRoleOptions as option (option.value)}
													<DropdownMenu.Item
														class="cursor-pointer text-xs text-muted-foreground focus:bg-muted focus:text-foreground"
														disabled={updatingMemberIds.includes(member.userId)}
														onclick={() => updateMemberRole(member.userId, option.value)}
														>{roleLabels[option.value]}</DropdownMenu.Item
													>
												{/each}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{:else}
										<Badge variant="secondary" class="text-[10px]"
											>{roleLabels[member.permissions]}</Badge
										>
									{/if}
								</div>
							</div>
						{/each}
						{#if members.length === 0}
							<p class="py-2 text-center text-xs text-muted-foreground">No additional members.</p>
						{/if}
					</div>
				</div>

				{#if isOwner}
					<!-- Delete Project -->
					<div
						class="rounded-xs border border-red-300 bg-red-100 p-5 dark:border-red-900/30 dark:bg-red-950/10"
					>
						<div
							class="mb-3 flex items-center gap-2 border-b border-red-300 pb-2 dark:border-red-900/20"
						>
							<Trash2 class="h-4 w-4 text-red-800 dark:text-red-400" />
							<p
								class="text-xs font-semibold tracking-wider text-red-800 uppercase dark:text-red-400"
							>
								Delete Project
							</p>
						</div>
						<p class="mb-3 text-xs text-muted-foreground">
							This will permanently delete the project and all its resources. Type the project name
							to confirm.
						</p>
						<div class="flex flex-col gap-3">
							<Input
								bind:value={deleteConfirm}
								placeholder={data.project.projectName}
								aria-label="Confirm project name"
								class="border-red-900/50"
							/>
							<Button
								variant="destructive"
								size="sm"
								onclick={deleteProject}
								disabled={deleteConfirm.trim() !== data.project.projectName || deleting}
								class="w-fit"
							>
								{#if deleting}
									<Loader2 class="h-3 w-3 animate-spin" />
									Deleting...
								{:else}
									Delete Project
								{/if}
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<Dialog.Root
	open={memberToRemove !== null}
	onOpenChange={(v) => {
		if (!v) memberToRemove = null;
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Remove Member</Dialog.Title>
			<Dialog.Description>
				{memberToRemove?.name} ({memberToRemove?.email}) will lose access to this project. They can
				be re-invited later.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (memberToRemove = null)}>Cancel</Button>
			<Button variant="destructive" size="sm" onclick={confirmRemoveMember}>Remove</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={addMemberOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Invite Member</Dialog.Title>
			<Dialog.Description>Send an email invitation to join this project.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Email</Label>
				<Input
					bind:value={memberInviteEmail}
					placeholder="member@example.com"
					type="email"
					disabled={addingMember}
					onkeydown={(e) => e.key === 'Enter' && addMember()}
				/>
			</div>
			<div class="flex flex-col gap-2">
				<Label>Role</Label>
				<div class="flex flex-col gap-2">
					{#each memberRoleOptions as option (option.value)}
						<button
							type="button"
							class="rounded-xs border p-3 text-left transition-colors {selectedMemberRole ===
							option.value
								? 'border-red-400/60 bg-muted/60'
								: 'border-border hover:border-ring'}"
							onclick={() => (selectedMemberRole = option.value)}
							disabled={addingMember}
						>
							<p class="text-sm font-medium text-foreground">{roleLabels[option.value]}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
						</button>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				size="sm"
				onclick={() => (addMemberOpen = false)}
				disabled={addingMember}>Cancel</Button
			>
			<Button size="sm" onclick={addMember} disabled={addingMember || !memberInviteEmail.trim()}>
				{#if addingMember}
					<Loader2 class="size-3.5 animate-spin" />
					Inviting...
				{:else}
					Send Invite
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
