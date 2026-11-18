<script lang="ts">
	import { ticketCategoryLabels } from 'stack-shared/support';
	import { toast } from 'svelte-sonner';
	import TicketComposer from '#lib/components/support/ticket-composer.svelte';
	import TicketThread from '#lib/components/support/ticket-thread.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { dependencies } from '#lib/dependencies.js';
	import { formatDateTime } from '#lib/format.js';
	import { closeTicket, replyToTicket } from '#lib/remote/support.remote.js';
	import { customerTicketStatus, supportHref, uploadAttachments } from '#lib/support.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import Loader2 from '~icons/lucide/loader-2';
	import Send from '~icons/nucleo/send';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let body = $state('');
	let attachments = $state<File[]>([]);
	let sending = $state(false);
	let closing = $state(false);

	const ticket = $derived(data.ticket);
	const status = $derived(customerTicketStatus[ticket.status]);
	const closed = $derived(ticket.status === 'closed');
	const canSend = $derived(!sending && body.trim().length > 0);

	async function sendReply(event: SubmitEvent) {
		event.preventDefault();
		if (!canSend) {
			return;
		}
		sending = true;
		try {
			await replyToTicket({
				ticketId: ticket.id,
				body,
				attachmentIds: await uploadAttachments(attachments)
			});
			body = '';
			attachments = [];
			await invalidate(dependencies.support.tickets);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to send reply'));
		} finally {
			sending = false;
		}
	}

	async function close() {
		closing = true;
		try {
			await closeTicket({ ticketId: ticket.id });
			await invalidate(dependencies.support.tickets);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to close ticket'));
		} finally {
			closing = false;
		}
	}
</script>

<svelte:head><title>Stack / {ticket.subject}</title></svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
		<div class="flex min-w-0 items-center gap-2">
			<a
				href={supportHref('', { projectId: data.currentProject?.id })}
				class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronLeft class="h-3.5 w-3.5" />
				<span class="sr-only sm:not-sr-only">Support</span>
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/</span>
			<h1 class="truncate text-sm font-semibold text-foreground">{ticket.subject}</h1>
			<Badge variant="outline" class="shrink-0 text-[10px] {status.badgeClass}">
				{status.label}
			</Badge>
		</div>
		{#if ticket.canClose && !closed}
			<Button
				variant="outline"
				size="sm"
				class="h-7 shrink-0 gap-1.5 px-3 text-xs"
				disabled={closing}
				onclick={close}
			>
				{#if closing}
					<Loader2 class="h-3 w-3 animate-spin" />
				{/if}
				Close ticket
			</Button>
		{/if}
	</div>

	<div class="flex-1 overflow-auto">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
			<dl class="flex flex-wrap gap-x-6 gap-y-2 text-xs">
				<div>
					<dt class="text-muted-foreground">Ticket</dt>
					<dd class="mt-0.5 text-foreground">#{ticket.number}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Category</dt>
					<dd class="mt-0.5 text-foreground">{ticketCategoryLabels[ticket.category]}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">About</dt>
					<dd class="mt-0.5 text-foreground">{ticket.project?.name ?? 'My account'}</dd>
				</div>
				{#if ticket.project && ticket.vm}
					<div>
						<dt class="text-muted-foreground">Server</dt>
						<dd class="mt-0.5">
							<a
								href={resolve(`projects/${ticket.project.id}/servers/${ticket.vm.id}`)}
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
						by {ticket.openedByStaff ? 'Fyra staff' : ticket.requesterName}
					</dd>
				</div>
			</dl>

			<TicketThread messages={data.messages} />

			<form class="flex flex-col gap-2" onsubmit={sendReply}>
				<TicketComposer
					bind:body
					bind:attachments
					label="Reply"
					placeholder="Write a reply"
					disabled={sending}
				/>
				<div class="flex justify-end">
					<Button type="submit" size="sm" class="gap-1.5" disabled={!canSend}>
						{#if sending}
							<Loader2 class="h-3 w-3 animate-spin" />
						{:else}
							<Send class="h-3 w-3" />
						{/if}
						Send reply
					</Button>
				</div>
			</form>
		</div>
	</div>
</div>
