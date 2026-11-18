<script lang="ts">
	import {
		type TicketCategory,
		type TicketPriority,
		ticketCategories,
		ticketCategoryLabels,
		ticketPriorities,
		ticketPriorityLabels
	} from 'stack-shared/support';
	import { toast } from 'svelte-sonner';
	import TicketComposer from '#lib/components/support/ticket-composer.svelte';
	import TicketThread from '#lib/components/support/ticket-thread.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { dependencies } from '#lib/dependencies.js';
	import { formatDateTime } from '#lib/format.js';
	import {
		moveAdminTicket,
		replyToAdminTicket,
		updateAdminTicket
	} from '#lib/remote/admin-support.remote.js';
	import { staffTicketStatus, uploadAttachments } from '#lib/support.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import Loader2 from '~icons/lucide/loader-2';
	import Send from '~icons/nucleo/send';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const UNASSIGNED = '';
	const ACCOUNT_LEVEL = '';
	const MAX_PROJECT_RESULTS = 6;

	let body = $state('');
	let attachments = $state<File[]>([]);
	let internal = $state(false);
	let sending = $state(false);
	let updating = $state(false);

	const ticket = $derived(data.ticket);
	const status = $derived(staffTicketStatus[ticket.status]);
	const closed = $derived(ticket.status === 'closed');
	const staff = $derived(data.adminUsers.filter((user) => user.isAdmin));
	const canSend = $derived(!sending && body.trim().length > 0);

	async function sendReply(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) {
			return;
		}
		sending = true;
		try {
			await replyToAdminTicket({
				ticketId: ticket.id,
				body,
				attachmentIds: await uploadAttachments(attachments),
				internal
			});
			body = '';
			attachments = [];
			await invalidate(dependencies.admin.tickets);
		} catch (err) {
			toast.error(getErrorMessage(err, internal ? 'Failed to add note' : 'Failed to send reply'));
		} finally {
			sending = false;
		}
	}

	async function update(changes: Omit<Parameters<typeof updateAdminTicket>[0], 'ticketId'>) {
		updating = true;
		try {
			await updateAdminTicket({ ticketId: ticket.id, ...changes });
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to update ticket'));
		} finally {
			await invalidate(dependencies.admin.tickets);
			updating = false;
		}
	}

	let moveOpen = $state(false);
	let moveSearch = $state('');
	let moveTargetId = $state(ACCOUNT_LEVEL);
	let moving = $state(false);
	let moveError = $state('');

	const projectMatches = $derived.by(() => {
		const term = moveSearch.trim().toLowerCase();
		return data.adminProjects
			.filter(
				(project) =>
					!term ||
					project.name.toLowerCase().includes(term) ||
					project.ownerEmail?.toLowerCase().includes(term)
			)
			.slice(0, MAX_PROJECT_RESULTS);
	});
	const moveTarget = $derived(
		data.adminProjects.find((project) => project.id === moveTargetId) ?? null
	);
	const moveChangesScope = $derived(moveTargetId !== (ticket.project?.id ?? ACCOUNT_LEVEL));

	function openMove() {
		moveSearch = '';
		moveTargetId = ticket.project?.id ?? ACCOUNT_LEVEL;
		moveError = '';
		moveOpen = true;
	}

	async function move() {
		moving = true;
		moveError = '';
		try {
			await moveAdminTicket({ ticketId: ticket.id, projectId: moveTargetId || null });
			await invalidate(dependencies.admin.tickets);
			moveOpen = false;
		} catch (err) {
			moveError = getErrorMessage(err, 'Failed to move ticket');
		} finally {
			moving = false;
		}
	}
</script>

{#snippet moveOption(
	id: string,
	name: string,
	detail: string
)}
	<li class="border-b border-border/50 last:border-b-0">
		<button
			type="button"
			aria-pressed={moveTargetId === id}
			class="flex w-full flex-col px-3 py-1.5 text-left transition-colors hover:bg-muted/40 aria-pressed:bg-muted"
			onclick={() => (moveTargetId = id)}
		>
			<span class="truncate text-sm text-foreground">{name}</span>
			<span class="truncate text-xs text-muted-foreground">{detail}</span>
		</button>
	</li>
{/snippet}

{#snippet field(
	name: string,
	label: string,
	value: string,
	options: string[][],
	onchange: (value: string) => void
)}
	<div class="flex flex-col gap-1.5">
		<Label for="ticket-{name}" class="text-xs text-muted-foreground">{label}</Label>
		<select
			id="ticket-{name}"
			class="h-8 w-full border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none disabled:opacity-50"
			{value}
			disabled={updating}
			onchange={(event) => onchange(event.currentTarget.value)}
		>
			{#each options as [optionValue, optionLabel] (optionValue)}
				<option value={optionValue}>{optionLabel}</option>
			{/each}
		</select>
	</div>
{/snippet}

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5">
		<a
			href={resolve('admin/support')}
			class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
		>
			<ChevronLeft class="h-3.5 w-3.5" />
			Inbox
		</a>
		<span class="text-sm text-muted-foreground">/</span>
		<h2 class="truncate text-sm font-semibold text-foreground">
			#{ticket.number}
			{ticket.subject}
		</h2>
		<Badge variant="outline" class="shrink-0 text-[10px] {status.badgeClass}">{status.label}</Badge>
	</div>

	<div class="flex flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
		<div class="flex-1 lg:overflow-auto">
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
				<TicketThread messages={data.messages} />

				<form class="flex flex-col gap-2" onsubmit={sendReply}>
					<TicketComposer
						bind:body
						bind:attachments
						label={internal ? 'Internal note' : 'Reply'}
						placeholder={internal ? 'Write a note only staff can see' : 'Write a reply'}
						disabled={sending}
					/>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<Switch id="ticket-internal" bind:checked={internal} />
							<Label for="ticket-internal" class="text-xs">Internal note</Label>
						</div>
						<Button type="submit" size="sm" class="shrink-0 gap-1.5" disabled={!canSend}>
							{#if sending}
								<Loader2 class="h-3 w-3 animate-spin" />
							{:else}
								<Send class="h-3 w-3" />
							{/if}
							{internal ? 'Add note' : 'Send reply'}
						</Button>
					</div>
				</form>
			</div>
		</div>

		<aside
			class="flex shrink-0 flex-col gap-4 border-t border-border p-5 lg:w-72 lg:overflow-auto lg:border-t-0 lg:border-l"
		>
			<Button
				variant="outline"
				size="sm"
				class="w-full"
				disabled={updating}
				onclick={() => update({ status: closed ? 'open' : 'closed' })}
			>
				{closed ? 'Reopen ticket' : 'Close ticket'}
			</Button>

			{@render field(
				'assignee',
				'Assignee',
				ticket.assignee?.id ?? UNASSIGNED,
				[
					[UNASSIGNED, 'Unassigned'],
					...staff.map(({ id, name }) => [id, id === data.user.id ? `${name} (me)` : name])
				],
				(value) => update({ assigneeId: value || null })
			)}
			{@render field(
				'priority',
				'Priority',
				ticket.priority,
				ticketPriorities.map((option) => [option, ticketPriorityLabels[option]]),
				(value) => update({ priority: value as TicketPriority })
			)}
			{@render field(
				'category',
				'Category',
				ticket.category,
				ticketCategories.map((option) => [option, ticketCategoryLabels[option]]),
				(value) => update({ category: value as TicketCategory })
			)}

			<dl class="flex flex-col gap-3 border-t border-border pt-4 text-xs">
				<div>
					<dt class="text-muted-foreground">Requester</dt>
					<dd class="mt-0.5">
						{#if ticket.requester}
							<a
								href={resolve(`admin/users/${ticket.requester.id}`)}
								class="text-foreground underline underline-offset-2"
							>
								{ticket.requester.name}
							</a>
							<p class="truncate text-muted-foreground">{ticket.requester.email}</p>
						{:else}
							<span class="text-foreground">Deleted user</span>
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Project</dt>
					<dd class="mt-0.5 flex items-center justify-between gap-2">
						{#if ticket.project}
							<a
								href={resolve(`admin/projects/${ticket.project.id}`)}
								class="truncate text-foreground underline underline-offset-2"
							>
								{ticket.project.name}
							</a>
						{:else}
							<span class="text-foreground">Account-level</span>
						{/if}
						<Button variant="outline" size="xs" class="shrink-0" onclick={openMove}>Move</Button>
					</dd>
				</div>
				{#if ticket.vm}
					<div>
						<dt class="text-muted-foreground">Server</dt>
						<dd class="mt-0.5">
							<a
								href={resolve(`admin/vms/${ticket.vm.id}`)}
								class="text-foreground underline underline-offset-2"
							>
								{ticket.vm.name}
							</a>
						</dd>
					</div>
				{/if}
				<div>
					<dt class="text-muted-foreground">Opened</dt>
					<dd class="mt-0.5 text-foreground">
						{formatDateTime(ticket.createdAt)}
						{ticket.openedByStaff ? 'by staff' : 'by the requester'}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Last activity</dt>
					<dd class="mt-0.5 text-foreground">{formatDateTime(ticket.updatedAt)}</dd>
				</div>
			</dl>
		</aside>
	</div>
</div>

<Dialog.Root bind:open={moveOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Move ticket</Dialog.Title>
		</Dialog.Header>
		<div class="flex flex-col gap-3 py-2">
			{#if moveError}
				<p class="text-xs text-red-700 dark:text-red-400" role="alert">{moveError}</p>
			{/if}
			<Input
				bind:value={moveSearch}
				placeholder="Search projects by name or owner"
				aria-label="Search projects"
				class="h-8 text-xs"
			/>
			<ul class="border border-border">
				{#if ticket.requester}
					{@render moveOption(
						ACCOUNT_LEVEL,
						'Account-level',
						`Visible only to ${ticket.requester.name}`
					)}
				{/if}
				{#each projectMatches as project (project.id)}
					{@render moveOption(project.id, project.name, project.ownerEmail ?? 'No owner')}
				{/each}
			</ul>
			{#if moveChangesScope}
				<p
					class="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-400"
				>
					{#if moveTarget}
						Every member of {moveTarget.name} will be able to read and reply to this ticket.
					{:else}
						Only {ticket.requester?.name} will be able to read this ticket. Other project members
						lose access.
					{/if}
					{#if ticket.vm}
						The link to {ticket.vm.name} will be removed.
					{/if}
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (moveOpen = false)}>Cancel</Button>
			<Button size="sm" disabled={moving || !moveChangesScope} onclick={move}>
				{#if moving}
					<Loader2 class="h-3 w-3 animate-spin" />
				{/if}
				Move ticket
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
