<script lang="ts">
	import {
		MAX_TICKET_SUBJECT_LENGTH,
		type TicketCategory,
		type TicketPriority,
		type TicketStatus,
		ticketCategories,
		ticketCategoryLabels,
		ticketPriorities,
		ticketPriorityLabels,
		ticketStatuses
	} from 'stack-shared/support';
	import FilterMenu from '#lib/components/admin/filter-menu.svelte';
	import TicketComposer from '#lib/components/support/ticket-composer.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { dependencies } from '#lib/dependencies.js';
	import { formatDateTime } from '#lib/format.js';
	import { createAdminTicket } from '#lib/remote/admin-support.remote.js';
	import { staffTicketStatus, ticketPriorityBadgeClass, uploadAttachments } from '#lib/support.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import LifeRing from '~icons/nucleo/life-ring';
	import Search from '~icons/nucleo/search';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Ticket = PageProps['data']['tickets'][number];
	type AssigneeFilter = 'mine' | 'unassigned';
	type TargetKind = 'project' | 'user';

	const MAX_TARGET_RESULTS = 6;
	const targetKinds: { kind: TargetKind; label: string }[] = [
		{ kind: 'project', label: 'A project' },
		{ kind: 'user', label: 'A user account' }
	];
	const statusOrder: Record<TicketStatus, number> = { open: 0, pending: 1, closed: 2 };
	const selectClass =
		'h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none';

	const statusOptions = ticketStatuses.map((value) => ({
		value,
		label: staffTicketStatus[value].label
	}));
	const priorityOptions = ticketPriorities.map((value) => ({
		value,
		label: ticketPriorityLabels[value]
	}));
	const categoryOptions = ticketCategories.map((value) => ({
		value,
		label: ticketCategoryLabels[value]
	}));
	const assigneeOptions: { label: string; value: AssigneeFilter }[] = [
		{ value: 'mine', label: 'Me' },
		{ value: 'unassigned', label: 'Unassigned' }
	];

	let search = $state('');
	let statusFilter = $state<TicketStatus | 'all'>('all');
	let priorityFilter = $state<TicketPriority | 'all'>('all');
	let categoryFilter = $state<TicketCategory | 'all'>('all');
	let assigneeFilter = $state<AssigneeFilter | 'all'>('all');

	function matchesSearch(ticket: Ticket, term: string) {
		return [
			ticket.subject,
			`#${ticket.number}`,
			ticket.requester?.name,
			ticket.requester?.email,
			ticket.project?.name
		].some((value) => value?.toLowerCase().includes(term));
	}

	function matchesAssignee(ticket: Ticket) {
		if (assigneeFilter === 'all') {
			return true;
		}
		return assigneeFilter === 'mine'
			? ticket.assignee?.id === data.user.id
			: ticket.assignee === null;
	}

	function byQueueOrder(first: Ticket, second: Ticket) {
		if (first.status !== second.status) {
			return statusOrder[first.status] - statusOrder[second.status];
		}
		return first.status === 'open'
			? first.updatedAt - second.updatedAt
			: second.updatedAt - first.updatedAt;
	}

	const filteredTickets = $derived.by(() => {
		const term = search.trim().toLowerCase();
		return data.tickets
			.filter(
				(ticket) =>
					(statusFilter === 'all' || ticket.status === statusFilter) &&
					(priorityFilter === 'all' || ticket.priority === priorityFilter) &&
					(categoryFilter === 'all' || ticket.category === categoryFilter) &&
					matchesAssignee(ticket) &&
					(!term || matchesSearch(ticket, term))
			)
			.sort(byQueueOrder);
	});

	let createOpen = $state(false);
	let targetKind = $state<TargetKind>('project');
	let targetSearch = $state('');
	let targetId = $state<string | null>(null);
	let category = $state<TicketCategory>('technical');
	let subject = $state('');
	let body = $state('');
	let attachments = $state<File[]>([]);
	let creating = $state(false);
	let createError = $state('');

	const targetCandidates = $derived(
		targetKind === 'project'
			? data.adminProjects.map((project) => ({
					id: project.id,
					name: project.name,
					detail: project.ownerEmail ?? 'No owner'
				}))
			: data.adminUsers.map((user) => ({ id: user.id, name: user.name, detail: user.email }))
	);
	const targetMatches = $derived.by(() => {
		const term = targetSearch.trim().toLowerCase();
		return targetCandidates
			.filter(
				(candidate) =>
					!term ||
					candidate.name.toLowerCase().includes(term) ||
					candidate.detail.toLowerCase().includes(term)
			)
			.slice(0, MAX_TARGET_RESULTS);
	});
	const selectedTarget = $derived(
		targetCandidates.find((candidate) => candidate.id === targetId) ?? null
	);
	const canCreate = $derived(
		!creating && targetId !== null && subject.trim().length > 0 && body.trim().length > 0
	);

	function openCreate() {
		targetKind = 'project';
		targetSearch = '';
		targetId = null;
		category = 'technical';
		subject = '';
		body = '';
		attachments = [];
		createError = '';
		createOpen = true;
	}

	function setTargetKind(kind: TargetKind) {
		targetKind = kind;
		targetSearch = '';
		targetId = null;
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!(canCreate && targetId)) {
			return;
		}
		creating = true;
		createError = '';
		try {
			const { id } = await createAdminTicket({
				target: targetKind === 'project' ? { projectId: targetId } : { userId: targetId },
				category,
				subject: subject.trim(),
				body,
				attachmentIds: await uploadAttachments(attachments)
			});
			await goto(resolve(`admin/support/${id}`), { invalidate: [dependencies.admin.tickets] });
		} catch (err) {
			createError = getErrorMessage(err, 'Failed to open ticket');
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex-1 overflow-auto">
	<div class="flex flex-col gap-5 p-5">
		<div class="flex items-center justify-between gap-3">
			<h2 class="text-base font-semibold tracking-tight text-foreground">Support</h2>
			<Button size="sm" class="h-7 shrink-0 gap-1.5 text-xs" onclick={openCreate}>
				<Plus class="h-3 w-3" />
				New ticket
			</Button>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative max-w-xs flex-1">
				<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={search}
					placeholder="Search subject, requester, project..."
					aria-label="Search tickets"
					class="h-8 pl-8 text-xs"
				/>
			</div>
			<FilterMenu
				label="Status"
				allLabel="All statuses"
				options={statusOptions}
				contentClass="w-48"
				bind:value={statusFilter}
			/>
			<FilterMenu
				label="Priority"
				allLabel="All priorities"
				options={priorityOptions}
				bind:value={priorityFilter}
			/>
			<FilterMenu
				label="Category"
				allLabel="All categories"
				options={categoryOptions}
				bind:value={categoryFilter}
			/>
			<FilterMenu
				label="Assignee"
				allLabel="Anyone"
				options={assigneeOptions}
				bind:value={assigneeFilter}
			/>
		</div>

		{#if filteredTickets.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
				<LifeRing class="mb-3 h-6 w-6" />
				<p class="text-xs">
					{data.tickets.length === 0 ? 'No tickets yet' : 'No tickets match these filters'}
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto border border-border">
				<table class="w-full">
					<thead>
						<tr
							class="border-b border-border text-left text-xs whitespace-nowrap text-muted-foreground [&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"
						>
							<th>Ticket</th>
							<th>Status</th>
							<th class="hidden md:table-cell">Priority</th>
							<th class="hidden lg:table-cell">Requester</th>
							<th class="hidden lg:table-cell">Assignee</th>
							<th class="hidden text-right sm:table-cell">Last activity</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/50">
						{#each filteredTickets as ticket (ticket.id)}
							{@const status = staffTicketStatus[ticket.status]}
							<tr class="transition-colors hover:bg-muted/20">
								<td class="max-w-md px-4 py-3">
									<a
										href={resolve(`admin/support/${ticket.id}`)}
										class="block truncate text-sm font-medium text-foreground hover:underline"
									>
										{ticket.subject}
									</a>
									<p class="mt-0.5 truncate text-xs text-muted-foreground">
										#{ticket.number}
										&bull; {ticketCategoryLabels[ticket.category]}
										&bull; {ticket.project?.name ?? 'Account-level'}
										{#if ticket.vm}
											&bull; {ticket.vm.name}
										{/if}
									</p>
								</td>
								<td class="px-4 py-3">
									<Badge
										variant="outline"
										class="text-[10px] whitespace-nowrap {status.badgeClass}"
									>
										{status.label}
									</Badge>
								</td>
								<td class="hidden px-4 py-3 md:table-cell">
									<Badge
										variant="outline"
										class="text-[10px] {ticketPriorityBadgeClass[ticket.priority]}"
									>
										{ticketPriorityLabels[ticket.priority]}
									</Badge>
								</td>
								<td class="hidden max-w-48 px-4 py-3 lg:table-cell">
									<p class="truncate text-sm text-foreground">
										{ticket.requester?.name ?? 'Deleted user'}
									</p>
									{#if ticket.requester}
										<p class="truncate text-xs text-muted-foreground">{ticket.requester.email}</p>
									{/if}
								</td>
								<td class="hidden px-4 py-3 text-sm text-muted-foreground lg:table-cell">
									{ticket.assignee?.name ?? 'Unassigned'}
								</td>
								<td
									class="hidden px-4 py-3 text-right text-sm whitespace-nowrap text-muted-foreground sm:table-cell"
								>
									{formatDateTime(ticket.updatedAt)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto border-border bg-background sm:max-w-2xl"
	>
		<Dialog.Header>
			<Dialog.Title>New ticket</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4 py-2" onsubmit={create}>
			{#if createError}
				<div
					class="flex items-center gap-2 border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-400"
					role="alert"
				>
					<AlertTriangle class="size-4 shrink-0" />{createError}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<fieldset>
					<legend class="mb-2 text-sm leading-none font-medium">Addressed to</legend>
					<div class="flex gap-1">
						{#each targetKinds as option (option.kind)}
							<button
								type="button"
								aria-pressed={targetKind === option.kind}
								class="h-8 border px-3 text-xs font-medium transition-colors {targetKind ===
								option.kind
									? 'border-red-500 text-foreground'
									: 'border-border text-muted-foreground hover:text-foreground'}"
								onclick={() => setTargetKind(option.kind)}
							>
								{option.label}
							</button>
						{/each}
					</div>
				</fieldset>
				{#if selectedTarget}
					<div class="flex items-center justify-between gap-3 border border-border px-3 py-2">
						<div class="min-w-0">
							<p class="truncate text-sm text-foreground">{selectedTarget.name}</p>
							<p class="truncate text-xs text-muted-foreground">{selectedTarget.detail}</p>
						</div>
						<Button variant="outline" size="sm" class="shrink-0" onclick={() => (targetId = null)}>
							Change
						</Button>
					</div>
				{:else}
					<Input
						bind:value={targetSearch}
						placeholder={targetKind === 'project'
							? 'Search projects by name or owner'
							: 'Search users by name or email'}
						aria-label={targetKind === 'project' ? 'Search projects' : 'Search users'}
						class="h-8 text-xs"
					/>
					<ul class="border border-border">
						{#each targetMatches as candidate (candidate.id)}
							<li class="border-b border-border/50 last:border-b-0">
								<button
									type="button"
									class="flex w-full flex-col px-3 py-1.5 text-left transition-colors hover:bg-muted/40"
									onclick={() => (targetId = candidate.id)}
								>
									<span class="truncate text-sm text-foreground">{candidate.name}</span>
									<span class="truncate text-xs text-muted-foreground">{candidate.detail}</span>
								</button>
							</li>
						{:else}
							<li class="px-3 py-2 text-xs text-muted-foreground">No matches</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
				<div class="flex flex-col gap-2">
					<Label for="admin-ticket-category">Category</Label>
					<select id="admin-ticket-category" class={selectClass} bind:value={category}>
						{#each ticketCategories as option (option)}
							<option value={option}>{ticketCategoryLabels[option]}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="admin-ticket-subject">Subject</Label>
					<Input
						id="admin-ticket-subject"
						bind:value={subject}
						maxlength={MAX_TICKET_SUBJECT_LENGTH}
						required
					/>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-sm leading-none font-medium" aria-hidden="true">Message</span>
				<TicketComposer bind:body bind:attachments label="Message" disabled={creating} />
			</div>

			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" size="sm" disabled={!canCreate}>
					{#if creating}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
					Open ticket
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
