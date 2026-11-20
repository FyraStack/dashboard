<script lang="ts">
	import { ticketCategoryLabels } from 'stack-shared/support';
	import FilterMenu from '#lib/components/admin/filter-menu.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { formatDateTime } from '#lib/format.js';
	import { accountScope, customerTicketStatus, supportHref } from '#lib/support.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Plus from '~icons/lucide/plus';
	import LifeRing from '~icons/nucleo/life-ring';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const SCOPE_PARAM = 'project';

	let showClosed = $state(false);

	const scope = $derived(page.url.searchParams.get(SCOPE_PARAM) ?? 'all');
	const scopeOptions = $derived([
		{ value: accountScope, label: 'My account' },
		...data.projects.map((project) => ({ value: project.id, label: project.projectName }))
	]);
	const newTicketScope = $derived(scope === 'all' ? null : scope);

	const scopedTickets = $derived(
		data.tickets.filter((ticket) => {
			if (scope === 'all') {
				return true;
			}
			return scope === accountScope ? ticket.project === null : ticket.project?.id === scope;
		})
	);
	const openTickets = $derived(scopedTickets.filter((ticket) => ticket.status !== 'closed'));
	const closedTickets = $derived(scopedTickets.filter((ticket) => ticket.status === 'closed'));
	const visibleTickets = $derived(showClosed ? closedTickets : openTickets);

	function setScope(next: string) {
		const url = new URL(page.url.href);
		if (next === 'all') {
			url.searchParams.delete(SCOPE_PARAM);
		} else {
			url.searchParams.set(SCOPE_PARAM, next);
		}
		goto(url, { replace: true, reset: false });
	}
</script>

<svelte:head><title>Stack / Support</title></svelte:head>

{#snippet statusTab(
	label: string,
	count: number,
	closed: boolean
)}
	<button
		type="button"
		aria-pressed={showClosed === closed}
		class="flex h-8 items-center gap-1.5 border-b-2 px-1 text-xs font-medium transition-colors {showClosed ===
		closed
			? 'border-red-500 text-foreground'
			: 'border-transparent text-muted-foreground hover:text-foreground'}"
		onclick={() => (showClosed = closed)}
	>
		{label}
		<Badge variant="secondary" class="text-[10px]">{count}</Badge>
	</button>
{/snippet}

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-5">
		<div class="flex items-center gap-2">
			<LifeRing class="h-4 w-4 text-muted-foreground" />
			<h1 class="text-sm font-semibold text-foreground">Support</h1>
		</div>
		<Button
			href={supportHref('new', { projectId: newTicketScope })}
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 px-3 text-xs"
		>
			<Plus class="h-3 w-3" />
			New ticket
		</Button>
	</div>

	<div
		class="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-1.5"
	>
		<div class="flex items-center gap-4">
			{@render statusTab('Open', openTickets.length, false)}
			{@render statusTab('Closed', closedTickets.length, true)}
		</div>
		<FilterMenu
			label="Scope"
			allLabel="Everything"
			options={scopeOptions}
			contentClass="w-56"
			bind:value={() => scope, setScope}
		/>
	</div>

	<div class="flex-1 overflow-auto">
		{#each visibleTickets as ticket (ticket.id)}
			{@const status = customerTicketStatus[ticket.status]}
			<a
				href={supportHref(ticket.id, { projectId: data.currentProject?.id })}
				class="flex items-center gap-4 border-b border-border px-5 py-3 transition-colors duration-100 hover:bg-muted/20"
			>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="truncate text-sm font-medium text-foreground">{ticket.subject}</span>
						<Badge variant="outline" class="shrink-0 text-[10px] {status.badgeClass}">
							{status.label}
						</Badge>
					</div>
					<p class="mt-1 truncate text-xs text-muted-foreground">
						#{ticket.number}
						&bull; {ticketCategoryLabels[ticket.category]}
						&bull; {ticket.project?.name ?? 'My account'}
						{#if ticket.vm}
							&bull; {ticket.vm.name}
						{/if}
					</p>
				</div>
				<p class="hidden shrink-0 text-xs text-muted-foreground sm:block">
					Updated {formatDateTime(ticket.updatedAt)}
				</p>
			</a>
		{:else}
			<div class="flex h-full flex-col items-center justify-center px-4 text-center">
				<div
					class="flex w-full max-w-80 flex-col items-center gap-4 border border-dashed border-border p-6 sm:p-8"
				>
					<LifeRing class="size-6 text-muted-foreground" />
					<div>
						<p class="text-base font-medium text-muted-foreground sm:text-sm">
							{showClosed ? 'No closed tickets' : 'No open tickets'}
						</p>
						<p class="mt-1 text-sm text-muted-foreground sm:text-xs">
							{showClosed
								? 'Tickets you or Fyra staff close will show up here.'
								: 'Open a ticket and Fyra staff will get back to you here and by email.'}
						</p>
					</div>
					{#if !showClosed}
						<Button
							href={supportHref('new', { projectId: newTicketScope })}
							variant="outline"
							size="sm"
							class="mt-2 h-10 gap-1.5 text-sm sm:h-8 sm:text-xs"
						>
							<Plus class="size-3.5" />
							New ticket
						</Button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
