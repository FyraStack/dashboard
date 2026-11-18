<script lang="ts">
	import { supportAttachmentPath } from 'stack-shared/routes';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { formatDateTime, initials } from '#lib/format.js';
	import { formatAttachmentSize } from '#lib/support.js';
	import Paperclip from '~icons/lucide/paperclip';
	import Lock from '~icons/nucleo/lock';

	interface ThreadMessage {
		attachments: { id: string; name: string; size: number }[];
		authorName: string;
		createdAt: number;
		html: string;
		id: string;
		internal?: boolean;
		staff: boolean;
	}

	let { messages }: { messages: ThreadMessage[] } = $props();
</script>

<ol class="flex flex-col gap-3">
	{#each messages as message (message.id)}
		<li
			class="border {message.internal
				? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
				: 'border-border'}"
		>
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-inherit px-3 py-2">
				<span
					class="flex size-6 shrink-0 items-center justify-center bg-muted text-[10px] font-medium text-muted-foreground"
					aria-hidden="true"
				>
					{initials(message.authorName)}
				</span>
				<span class="text-sm font-medium text-foreground">{message.authorName}</span>
				{#if message.staff}
					<Badge
						variant="outline"
						class="border-red-300 text-[10px] text-red-700 dark:border-red-700 dark:text-red-400"
					>
						Staff
					</Badge>
				{/if}
				{#if message.internal}
					<Badge
						variant="outline"
						class="gap-1 border-amber-300 text-[10px] text-amber-800 dark:border-amber-800 dark:text-amber-400"
					>
						<Lock class="size-3" />
						Internal note
					</Badge>
				{/if}
				<time
					class="ml-auto text-xs text-muted-foreground"
					datetime={new Date(message.createdAt).toISOString()}
				>
					{formatDateTime(message.createdAt)}
				</time>
			</div>
			<div class="message-body px-3 py-3 text-sm text-foreground">
				{@html message.html}
			</div>
			{#if message.attachments.length > 0}
				<ul class="flex flex-wrap gap-1.5 border-t border-inherit px-3 py-2">
					{#each message.attachments as attachment (attachment.id)}
						<li class="max-w-full">
							<a
								href={supportAttachmentPath(attachment.id)}
								download={attachment.name}
								class="flex items-center gap-1.5 border border-border bg-muted/40 px-2 py-0.5 text-xs transition-colors hover:border-ring"
							>
								<Paperclip class="size-3 shrink-0 text-muted-foreground" />
								<span class="truncate text-foreground">{attachment.name}</span>
								<span class="shrink-0 text-muted-foreground">
									{formatAttachmentSize(attachment.size)}
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.message-body {
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	.message-body > :global(* + *) {
		margin-top: 0.75rem;
	}

	.message-body :global(:is(h1, h2, h3, h4, h5, h6)) {
		font-size: 1rem;
		font-weight: 600;
	}

	.message-body :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.message-body :global(ul) {
		padding-left: 1.25rem;
		list-style: disc;
	}

	.message-body :global(ol) {
		padding-left: 1.25rem;
		list-style: decimal;
	}

	.message-body :global(li + li) {
		margin-top: 0.25rem;
	}

	.message-body :global(blockquote) {
		padding-left: 0.75rem;
		color: var(--muted-foreground);
		border-left: 2px solid var(--border);
	}

	.message-body :global(code) {
		padding: 0.1rem 0.3rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		background-color: var(--muted);
	}

	.message-body :global(pre) {
		padding: 0.625rem 0.75rem;
		overflow-x: auto;
		background-color: var(--muted);
	}

	.message-body :global(pre code) {
		padding: 0;
	}

	.message-body :global(hr) {
		border-color: var(--border);
	}
</style>
