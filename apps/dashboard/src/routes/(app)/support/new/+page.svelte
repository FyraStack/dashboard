<script lang="ts">
	import {
		MAX_TICKET_SUBJECT_LENGTH,
		type TicketCategory,
		ticketCategories,
		ticketCategoryLabels
	} from 'stack-shared/support';
	import TicketComposer from '#lib/components/support/ticket-composer.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { dependencies } from '#lib/dependencies.js';
	import { createTicket } from '#lib/remote/support.remote.js';
	import { accountScope, supportHref, uploadAttachments } from '#lib/support.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeft from '~icons/lucide/chevron-left';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const NO_SERVER = '';
	const selectClass =
		'h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none';

	let category = $state<TicketCategory>('technical');
	let subject = $state('');
	let body = $state('');
	let attachments = $state<File[]>([]);
	let serverChoice = $state<string | null>(null);
	let submitting = $state(false);
	let formError = $state('');

	const ticketProject = $derived(data.currentProject);
	const scope = $derived(ticketProject?.id ?? accountScope);
	const serverId = $derived(serverChoice ?? data.preselectedServerId ?? NO_SERVER);
	const canSubmit = $derived(!submitting && subject.trim().length > 0 && body.trim().length > 0);

	function setScope(next: string) {
		serverChoice = NO_SERVER;
		const url = new URL(page.url.href);
		url.searchParams.delete('vm');
		if (next === accountScope) {
			url.searchParams.delete('project');
		} else {
			url.searchParams.set('project', next);
		}
		goto(url, { replace: true, reset: false });
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		submitting = true;
		formError = '';
		try {
			const { id } = await createTicket({
				projectId: ticketProject?.id ?? null,
				vmId: serverId || null,
				category,
				subject: subject.trim(),
				body,
				attachmentIds: await uploadAttachments(attachments)
			});
			await goto(supportHref(id, { projectId: ticketProject?.id }), {
				invalidate: [dependencies.support.tickets]
			});
		} catch (err) {
			formError = getErrorMessage(err, 'Failed to open ticket');
			submitting = false;
		}
	}
</script>

<svelte:head><title>Stack / New ticket</title></svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5">
		<a
			href={supportHref('', { projectId: ticketProject?.id })}
			class="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
		>
			<ChevronLeft class="h-3.5 w-3.5" />
			Support
		</a>
		<span class="text-sm text-muted-foreground">/</span>
		<h1 class="text-sm font-semibold text-foreground">New ticket</h1>
	</div>

	<div class="flex-1 overflow-auto">
		<form class="mx-auto flex w-full max-w-2xl flex-col gap-5 p-5" onsubmit={submit}>
			{#if formError}
				<div
					class="flex items-center gap-2 border border-red-300 bg-red-100 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-400"
					role="alert"
				>
					<AlertTriangle class="size-4 shrink-0" />{formError}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="ticket-scope">What is this about?</Label>
				<select
					id="ticket-scope"
					class={selectClass}
					value={scope}
					onchange={(event) => setScope(event.currentTarget.value)}
				>
					{#each data.projects as project (project.id)}
						<option value={project.id}>Project: {project.projectName}</option>
					{/each}
					<option value={accountScope}>My account</option>
				</select>
			</div>

			{#if ticketProject && data.servers.length > 0}
				<div class="flex flex-col gap-2">
					<Label for="ticket-server">Server (optional)</Label>
					<select
						id="ticket-server"
						class={selectClass}
						value={serverId}
						onchange={(event) => (serverChoice = event.currentTarget.value)}
					>
						<option value={NO_SERVER}>Not about a specific server</option>
						{#each data.servers as server (server.id)}
							<option value={server.id}>{server.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="ticket-category">Category</Label>
				<select id="ticket-category" class={selectClass} bind:value={category}>
					{#each ticketCategories as option (option)}
						<option value={option}>{ticketCategoryLabels[option]}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="ticket-subject">Subject</Label>
				<Input
					id="ticket-subject"
					bind:value={subject}
					maxlength={MAX_TICKET_SUBJECT_LENGTH}
					placeholder="A short summary of the problem"
					required
				/>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-sm leading-none font-medium" aria-hidden="true">Message</span>
				<TicketComposer
					bind:body
					bind:attachments
					label="Message"
					placeholder="What happened, what you expected, and anything you've already tried"
					disabled={submitting}
				/>
			</div>

			<div class="flex items-center justify-end gap-2">
				<Button
					href={supportHref('', { projectId: ticketProject?.id })}
					variant="outline"
					size="sm"
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={!canSubmit}>
					{#if submitting}
						<Loader2 class="h-3 w-3 animate-spin" />
					{/if}
					Open ticket
				</Button>
			</div>
		</form>
	</div>
</div>
