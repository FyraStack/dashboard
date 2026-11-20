<script lang="ts">
	import { MAX_TICKET_ATTACHMENT_BYTES, MAX_TICKET_ATTACHMENTS } from 'stack-shared/support';
	import { untrack } from 'svelte';
	import { Editor } from 'tiny-markdown-editor/lib/tiny';
	import type { IconComponent } from '#lib';
	import { attachmentProblem, formatAttachmentSize } from '#lib/support.js';
	import Bold from '~icons/lucide/bold';
	import Code from '~icons/lucide/code';
	import Heading from '~icons/lucide/heading';
	import Italic from '~icons/lucide/italic';
	import LinkIcon from '~icons/lucide/link';
	import List from '~icons/lucide/list';
	import ListOrdered from '~icons/lucide/list-ordered';
	import Paperclip from '~icons/lucide/paperclip';
	import Strikethrough from '~icons/lucide/strikethrough';
	import TextQuote from '~icons/lucide/text-quote';
	import X from '~icons/lucide/x';

	let {
		body = $bindable(''),
		attachments = $bindable([]),
		label,
		placeholder = '',
		disabled = false
	}: {
		attachments?: File[];
		body?: string;
		disabled?: boolean;
		label: string;
		placeholder?: string;
	} = $props();

	interface FormatCommand {
		command: string;
		icon: IconComponent;
		label: string;
	}

	const formatCommands: FormatCommand[] = [
		{ command: 'bold', label: 'Bold', icon: Bold },
		{ command: 'italic', label: 'Italic', icon: Italic },
		{ command: 'strikethrough', label: 'Strikethrough', icon: Strikethrough },
		{ command: 'code', label: 'Code', icon: Code },
		{ command: 'h2', label: 'Heading', icon: Heading },
		{ command: 'ul', label: 'Bulleted list', icon: List },
		{ command: 'ol', label: 'Numbered list', icon: ListOrdered },
		{ command: 'blockquote', label: 'Quote', icon: TextQuote }
	];
	const formatHotkeys: Record<string, string> = { b: 'bold', i: 'italic' };
	const toolbarButtonClass =
		'flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground';

	let editor = $state.raw<Editor>();
	let commandState = $state.raw<Record<string, boolean | null>>({});
	let attachmentError = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	function mountEditor(element: HTMLElement) {
		const mounted = new Editor({
			editor: element,
			...untrack(() => ({ content: body, placeholder }))
		});
		mounted.addEventListener('change', (event) => {
			body = event.content;
		});
		mounted.addEventListener('selection', (event) => {
			({ commandState } = event);
		});
		editor = mounted;

		return () => {
			mounted.destroy();
			editor = undefined;
		};
	}

	$effect(() => {
		if (editor && editor.getContent() !== body) {
			editor.setContent(body);
		}
	});

	function focusedEditor() {
		const element = editor?.e;
		if (!(editor && element)) {
			return null;
		}
		const hadFocus = element.contains(document.activeElement);
		element.focus();
		if (!hadFocus) {
			editor.restoreLastSelection();
		}
		return editor;
	}

	function toggleFormat(command: string) {
		focusedEditor()?.setCommandState(command, commandState[command] !== true);
	}

	function insertLink() {
		const target = focusedEditor();
		if (target?.isInlineFormattingAllowed()) {
			target.wrapSelection('[', ']()');
		}
	}

	function handleHotkey(event: KeyboardEvent) {
		const command = formatHotkeys[event.key.toLowerCase()];
		if (!command || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) {
			return;
		}
		event.preventDefault();
		toggleFormat(command);
	}

	function keepEditorSelection(event: MouseEvent) {
		event.preventDefault();
	}

	function addFiles(event: Event & { currentTarget: HTMLInputElement }) {
		const added = [...(event.currentTarget.files ?? [])];
		event.currentTarget.value = '';
		attachmentError = attachmentProblem(attachments, added) ?? '';
		if (!attachmentError) {
			attachments = [...attachments, ...added];
		}
	}

	function removeFile(index: number) {
		attachments = attachments.filter((_, position) => position !== index);
		attachmentError = '';
	}
</script>

<div
	class="border border-input bg-transparent transition-colors focus-within:border-ring dark:bg-input/30 high-contrast:bg-background {disabled
		? 'opacity-60'
		: ''}"
	inert={disabled}
>
	<div
		role="toolbar"
		aria-label="Formatting"
		class="flex flex-wrap items-center gap-0.5 border-b border-border px-1 py-1"
	>
		{#each formatCommands as item (item.command)}
			<button
				type="button"
				class={toolbarButtonClass}
				aria-label={item.label}
				title={item.label}
				aria-pressed={commandState[item.command] === true}
				onmousedown={keepEditorSelection}
				onclick={() => toggleFormat(item.command)}
			>
				<item.icon class="size-3.5" />
			</button>
		{/each}
		<button
			type="button"
			class={toolbarButtonClass}
			aria-label="Link"
			title="Link"
			onmousedown={keepEditorSelection}
			onclick={insertLink}
		>
			<LinkIcon class="size-3.5" />
		</button>
	</div>

	<!-- biome-ignore lint/a11y/useSemanticElements: the editor renders formatted markup, which a textarea cannot hold -->
	<div
		{@attach mountEditor}
		role="textbox"
		tabindex="0"
		aria-multiline="true"
		aria-label={label}
		class="markdown-editor max-h-96 min-h-28 overflow-y-auto px-3 py-2 text-sm text-foreground outline-none"
		onkeydown={handleHotkey}
	></div>

	<div class="flex flex-col gap-2 border-t border-border px-2 py-2">
		{#if attachments.length > 0}
			<ul class="flex flex-wrap gap-1.5">
				{#each attachments as file, index (file)}
					<li
						class="flex max-w-full items-center gap-1.5 border border-border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs"
					>
						<span class="truncate text-foreground">{file.name}</span>
						<span class="shrink-0 text-muted-foreground">{formatAttachmentSize(file.size)}</span>
						<button
							type="button"
							class="flex size-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
							aria-label={`Remove ${file.name}`}
							onclick={() => removeFile(index)}
						>
							<X class="size-3" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<input
				bind:this={fileInput}
				type="file"
				multiple
				tabindex="-1"
				aria-label="Attach files"
				class="sr-only"
				onchange={addFiles}
			/>
			<button
				type="button"
				class="flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => fileInput?.click()}
			>
				<Paperclip class="size-3.5" />
				Attach files
			</button>
			{#if attachmentError}
				<p class="text-xs text-red-700 dark:text-red-400" role="alert">{attachmentError}</p>
			{:else}
				<p class="text-[11px] text-muted-foreground">
					Up to {MAX_TICKET_ATTACHMENTS} files,
					{formatAttachmentSize(MAX_TICKET_ATTACHMENT_BYTES)}
					each
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.markdown-editor {
		line-height: 1.5rem;
	}

	.markdown-editor :global(.TMBlankLine) {
		height: 1.5rem;
	}

	.markdown-editor:global(.TinyMDE_empty) {
		position: relative;
	}

	.markdown-editor:global(.TinyMDE_empty)::before {
		position: absolute;
		color: var(--muted-foreground);
		pointer-events: none;
		content: attr(data-placeholder);
	}

	.markdown-editor :global(.TMH1),
	.markdown-editor :global(.TMH2),
	.markdown-editor :global(.TMSetextH1),
	.markdown-editor :global(.TMSetextH2) {
		font-size: 1rem;
		font-weight: 600;
	}

	.markdown-editor :global(.TMMark),
	.markdown-editor :global(.TMInfoString),
	.markdown-editor :global(.TMLinkDestination),
	.markdown-editor :global(.TMLinkTitle) {
		color: var(--muted-foreground);
	}

	.markdown-editor :global(.TMStrikethrough) {
		text-decoration: line-through;
	}

	.markdown-editor :global(.TMCode),
	.markdown-editor :global(.TMFencedCodeBacktick),
	.markdown-editor :global(.TMFencedCodeTilde),
	.markdown-editor :global(.TMIndentedCode),
	.markdown-editor :global(.TMCodeFenceBacktickOpen),
	.markdown-editor :global(.TMCodeFenceBacktickClose),
	.markdown-editor :global(.TMCodeFenceTildeOpen),
	.markdown-editor :global(.TMCodeFenceTildeClose),
	.markdown-editor :global(.TMHTML),
	.markdown-editor :global(.TMHTMLBlock) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
	}

	.markdown-editor :global(.TMCode),
	.markdown-editor :global(.TMFencedCodeBacktick),
	.markdown-editor :global(.TMFencedCodeTilde),
	.markdown-editor :global(.TMIndentedCode) {
		background-color: var(--muted);
	}

	.markdown-editor :global(.TMBlockquote) {
		padding-left: 0.75rem;
		color: var(--muted-foreground);
		border-left: 2px solid var(--border);
	}

	.markdown-editor :global(.TMLink),
	.markdown-editor :global(.TMAutolink),
	.markdown-editor :global(.TMImage) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown-editor :global(.TMHR) {
		color: var(--muted-foreground);
	}
</style>
