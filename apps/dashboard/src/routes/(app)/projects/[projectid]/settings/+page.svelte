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
	import { Settings, User, Trash2, Check, Plus, Loader2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';

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
	let removingMemberIds = $state<string[]>([]);
	let updatingMemberIds = $state<string[]>([]);

	let projectId = $derived(data.project.id);

	const viewerRole = $derived(data.viewerRole as ProjectRole);
	const isOwner = $derived(viewerRole === 'owner');
	const canManageMembers = $derived(viewerRole === 'owner' || viewerRole === 'admin');
	const currentUserId = $derived(data.user?.id);

	const roleLabels: Record<ProjectRole, string> = {
		owner: 'Owner',
		admin: 'Admin',
		read_write: 'Read Write',
		read: 'Read'
	};

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
			addMemberOpen = false;
			toast.success(`Invitation sent to ${email}`);
			await invalidate('app:projects');
		} catch (e) {
			toast.error(getErrorMessage(e, 'Failed to add member'));
		} finally {
			addingMember = false;
		}
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
			<div class="flex flex-col gap-6">
				<!-- Project Name -->
				<div class="rounded-xs border border-gray-800/60 p-5">
					<div class="mb-4 flex items-center gap-2 border-b border-gray-800/50 pb-3">
						<Settings class="h-4 w-4 text-red-400" />
						<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Project Name</p>
					</div>
					<div class="flex flex-col gap-3">
						<Input bind:value={projectName} class="font-medium" disabled={!canManageMembers} />
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
				<div class="rounded-xs border border-gray-800/60 p-5">
					<div class="mb-4 flex items-center justify-between border-b border-gray-800/50 pb-3">
						<div class="flex items-center gap-2">
							<User class="h-4 w-4 text-red-400" />
							<p class="text-xs font-semibold tracking-wider text-gray-400 uppercase">Members</p>
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
								<p class="truncate text-sm font-medium text-gray-100">{projectOwnerName}</p>
								<p class="truncate text-xs text-gray-500">{projectOwnerEmail}</p>
							</div>
							<Badge variant="secondary" class="shrink-0 text-[10px]">Owner</Badge>
						</div>
						<div class="border-b border-gray-800/30"></div>
						<!-- Other members -->
						{#each members as member (member.userId)}
							<div class="flex items-center justify-between py-2.5">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-gray-100">{member.name}</p>
									<p class="truncate text-xs text-gray-500">{member.email}</p>
									{#if canManageMembers && member.userId !== currentUserId}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												<span
													class="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-xs bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 transition-colors hover:bg-gray-700"
													>{roleLabels[member.permissions]}</span
												>
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="start" class="border-gray-800 bg-gray-900">
												<DropdownMenu.Item
													class="cursor-pointer text-xs text-gray-300 focus:bg-gray-800 focus:text-gray-100"
													disabled={updatingMemberIds.includes(member.userId)}
													onclick={() => updateMemberRole(member.userId, 'admin')}
													>Admin</DropdownMenu.Item
												>
												<DropdownMenu.Item
													class="cursor-pointer text-xs text-gray-300 focus:bg-gray-800 focus:text-gray-100"
													disabled={updatingMemberIds.includes(member.userId)}
													onclick={() => updateMemberRole(member.userId, 'read_write')}
													>Read Write</DropdownMenu.Item
												>
												<DropdownMenu.Item
													class="cursor-pointer text-xs text-gray-300 focus:bg-gray-800 focus:text-gray-100"
													disabled={updatingMemberIds.includes(member.userId)}
													onclick={() => updateMemberRole(member.userId, 'read')}
													>Read</DropdownMenu.Item
												>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{:else}
										<span
											class="mt-1 inline-flex items-center gap-1 rounded-xs bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400"
											>{roleLabels[member.permissions]}</span
										>
									{/if}
								</div>
								{#if canManageMembers && member.userId !== currentUserId}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 shrink-0 p-0 text-gray-500 hover:text-red-400"
										aria-label={`Remove ${member.name}`}
										onclick={() => removeMember(member.userId)}
										disabled={removingMemberIds.includes(member.userId) ||
											updatingMemberIds.includes(member.userId)}
									>
										{#if removingMemberIds.includes(member.userId)}
											<Loader2 class="h-3.5 w-3.5 animate-spin" />
										{:else}
											<Trash2 class="h-3.5 w-3.5" />
										{/if}
									</Button>
								{/if}
							</div>
						{/each}
						{#if members.length === 0}
							<p class="py-2 text-center text-xs text-gray-500">No additional members.</p>
						{/if}
					</div>

					<!-- Add Member Form -->
					{#if addMemberOpen}
						<div class="mt-3 border-t border-gray-800/50 pt-3">
							<p class="mb-2 text-xs font-medium text-gray-400">Invite member by email</p>
							<div class="flex flex-col gap-2">
								<div class="flex gap-2">
									<Input
										bind:value={memberInviteEmail}
										placeholder="member@example.com"
										type="email"
										class="h-8 text-xs"
										disabled={addingMember}
									/>
									<Button
										variant="outline"
										size="sm"
										class="h-8 shrink-0 gap-1.5 text-xs"
										onclick={addMember}
										disabled={addingMember || !memberInviteEmail.trim()}
									>
										{#if addingMember}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Plus
												class="h-3 w-3"
											/>{/if}
										{addingMember ? 'Inviting...' : 'Invite'}
									</Button>
								</div>
								<div class="flex items-center gap-2">
									<span class="text-xs text-gray-500">Role:</span>
									<div class="flex gap-1">
										<button
											type="button"
											class="rounded-xs px-2 py-1 text-[10px] font-medium transition-colors {selectedMemberRole ===
											'admin'
												? 'bg-gray-700 text-gray-100'
												: 'text-gray-500 hover:text-gray-300'}"
											onclick={() => (selectedMemberRole = 'admin')}>Admin</button
										>
										<button
											type="button"
											class="rounded-xs px-2 py-1 text-[10px] font-medium transition-colors {selectedMemberRole ===
											'read_write'
												? 'bg-gray-700 text-gray-100'
												: 'text-gray-500 hover:text-gray-300'}"
											onclick={() => (selectedMemberRole = 'read_write')}>Read Write</button
										>
										<button
											type="button"
											class="rounded-xs px-2 py-1 text-[10px] font-medium transition-colors {selectedMemberRole ===
											'read'
												? 'bg-gray-700 text-gray-100'
												: 'text-gray-500 hover:text-gray-300'}"
											onclick={() => (selectedMemberRole = 'read')}>Read</button
										>
									</div>
								</div>
							</div>
						</div>
					{/if}
				</div>

				{#if isOwner}
					<!-- Delete Project -->
					<div class="rounded-xs border border-red-900/30 bg-red-950/10 p-5">
						<div class="mb-3 flex items-center gap-2 border-b border-red-900/20 pb-2">
							<Trash2 class="h-4 w-4 text-red-400" />
							<p class="text-xs font-semibold tracking-wider text-red-400 uppercase">
								Delete Project
							</p>
						</div>
						<p class="mb-3 text-xs text-gray-400">
							This will permanently delete the project and all its resources. Type the project name
							to confirm.
						</p>
						<div class="flex flex-col gap-3">
							<Input
								bind:value={deleteConfirm}
								placeholder={data.project.projectName}
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
