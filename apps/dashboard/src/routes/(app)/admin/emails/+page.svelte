<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import { featureFlagKeys } from '$lib/feature-flags';
	import { parseCsv } from '$lib/csv';
	import {
		CAMPAIGN_BATCH_SIZE,
		campaignTemplates,
		extractPlaceholders,
		fieldToken
	} from '$lib/emails/campaign-registry';
	import {
		previewCampaignEmail,
		renderCampaignEditor,
		sendCampaignEmails
	} from '$lib/remote/email-campaign.remote';
	import { getErrorMessage } from '$lib/utils';
	import { AdminState, type AdminPageData } from '$lib/state/admin.svelte';
	import Check from '~icons/lucide/check';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Cpu from '~icons/nucleo/cpu';
	import Disc from '~icons/nucleo/disc';
	import Eye from '~icons/nucleo/eye';
	import Flag from '~icons/nucleo/flag';
	import Mail from '~icons/nucleo/mail';
	import Network from '~icons/nucleo/network';
	import Send from '~icons/nucleo/send';
	import Server from '~icons/nucleo/server';
	import UserCog from '~icons/nucleo/user-cog';
	import Users from '~icons/nucleo/users';

	type AdminTab = 'features' | 'vmTypes' | 'images' | 'ipam' | 'users' | 'vms' | 'emails';
	let { data }: { data: AdminPageData } = $props();
	const activeTab = 'emails' as AdminTab;
	const admin = new AdminState(untrack(() => data));
	$effect(() => {
		admin.sync(data);
	});

	const userCount = $derived(admin.adminUsers.length);

	let selectedTemplateKey = $state(campaignTemplates[0].key);
	let subject = $state(campaignTemplates[0].defaultSubject);
	let fieldValues = $state<Record<string, string>>(defaultFieldValues(campaignTemplates[0].key));
	const template = $derived(
		campaignTemplates.find((entry) => entry.key === selectedTemplateKey) ?? campaignTemplates[0]
	);
	const settingsFields = $derived(template.fields.filter((field) => !field.inline));

	function defaultFieldValues(key: string) {
		const entry = campaignTemplates.find((candidate) => candidate.key === key);
		const values: Record<string, string> = {};
		for (const field of entry?.fields ?? []) values[field.name] = field.defaultValue ?? '';
		return values;
	}

	function selectTemplate(key: string) {
		if (key === selectedTemplateKey || sending) return;
		selectedTemplateKey = key;
		subject = campaignTemplates.find((entry) => entry.key === key)?.defaultSubject ?? '';
		fieldValues = defaultFieldValues(key);
		void loadEditor();
	}

	let editorHtml = $state('');
	let editorLoading = $state(false);
	let editorError = $state('');
	let editorRequest = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	function prepareEditorHtml(raw: string) {
		const doc = new DOMParser().parseFromString(raw, 'text/html');
		let html = doc.body.innerHTML;
		for (const field of template.fields) {
			if (!field.inline) continue;
			html = html.replaceAll(fieldToken(field.name), `<span data-field="${field.name}"></span>`);
		}
		return html;
	}

	async function loadEditor() {
		const request = ++editorRequest;
		editorLoading = true;
		editorError = '';
		try {
			const settings: Record<string, string> = {};
			for (const field of settingsFields) settings[field.name] = fieldValues[field.name] ?? '';
			const result = await renderCampaignEditor({
				template: selectedTemplateKey,
				fields: settings
			});
			if (request !== editorRequest) return;
			editorHtml = prepareEditorHtml(result.html);
		} catch (err) {
			if (request === editorRequest) {
				editorError = getErrorMessage(err, 'Failed to render the template');
			}
		} finally {
			if (request === editorRequest) editorLoading = false;
		}
	}

	function scheduleEditorRefresh() {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => void loadEditor(), 500);
	}

	function hydrateFields(node: HTMLElement) {
		for (const span of node.querySelectorAll<HTMLElement>('[data-field]')) {
			const name = span.dataset.field ?? '';
			const field = template.fields.find((candidate) => candidate.name === name);
			span.textContent = fieldValues[name] ?? '';
			span.dataset.placeholder = field?.label ?? name;
			span.spellcheck = false;
			try {
				span.contentEditable = 'plaintext-only';
			} catch {
				span.contentEditable = 'true';
			}
			span.addEventListener('input', () => {
				const value = span.innerText.replace(/\u00a0/g, ' ');
				fieldValues[name] = value;
				for (const other of node.querySelectorAll<HTMLElement>(
					`[data-field="${CSS.escape(name)}"]`
				)) {
					if (other !== span) other.textContent = value;
				}
			});
		}
	}

	onMount(() => {
		void loadEditor();
		return () => clearTimeout(refreshTimer);
	});

	let csvFileName = $state('');
	let csvColumns = $state<string[]>([]);
	let csvRows = $state<Record<string, string>[]>([]);
	let csvError = $state('');
	let emailColumn = $state('');

	async function handleCsvChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		csvError = '';
		try {
			const parsed = parseCsv(await file.text());
			if (parsed.columns.length === 0 || parsed.rows.length === 0) {
				throw new Error('The CSV needs a header row and at least one data row');
			}
			csvFileName = file.name;
			csvColumns = parsed.columns;
			csvRows = parsed.rows;
			emailColumn = guessEmailColumn(parsed.columns, parsed.rows);
			sendComplete = false;
			sentCount = 0;
			sendFailures = [];
		} catch (err) {
			csvError = getErrorMessage(err, 'Failed to parse CSV');
			csvFileName = '';
			csvColumns = [];
			csvRows = [];
			emailColumn = '';
		}
		input.value = '';
	}

	function guessEmailColumn(columns: string[], rows: Record<string, string>[]) {
		const byName = columns.find((column) => column.toLowerCase().includes('email'));
		if (byName) return byName;
		return columns.find((column) => rows.some((row) => row[column]?.includes('@'))) ?? '';
	}

	const usedPlaceholders = $derived([
		...new Set(
			[subject, ...template.fields.map((field) => fieldValues[field.name] ?? '')].flatMap(
				extractPlaceholders
			)
		)
	]);
	const missingColumns = $derived(
		csvColumns.length > 0
			? usedPlaceholders.filter((placeholder) => !csvColumns.includes(placeholder))
			: []
	);

	let previewOpen = $state(false);
	let previewLoading = $state(false);
	let previewError = $state('');
	let previewSubject = $state('');
	let previewHtml = $state('');

	async function openPreview() {
		previewLoading = true;
		previewError = '';
		try {
			const result = await previewCampaignEmail({
				template: selectedTemplateKey,
				subject,
				fields: $state.snapshot(fieldValues),
				row: $state.snapshot(csvRows)[0] ?? {}
			});
			previewSubject = result.subject;
			previewHtml = result.html;
			previewOpen = true;
		} catch (err) {
			previewError = getErrorMessage(err, 'Failed to render preview');
		} finally {
			previewLoading = false;
		}
	}

	let sending = $state(false);
	let sendComplete = $state(false);
	let sentCount = $state(0);
	let sendFailures = $state<{ recipient: string; reason: string }[]>([]);
	let sendError = $state('');

	const fieldsComplete = $derived(
		template.fields.every(
			(field) => !field.required || (fieldValues[field.name] ?? '').trim() !== ''
		)
	);
	const canPreview = $derived(!previewLoading && subject.trim() !== '' && fieldsComplete);
	const canSend = $derived(
		!sending && csvRows.length > 0 && emailColumn !== '' && subject.trim() !== '' && fieldsComplete
	);
	const processedCount = $derived(sentCount + sendFailures.length);

	async function startSend() {
		if (!canSend) return;
		const ok = await confirmDestructive({
			title: 'Send emails',
			description: `This sends the "${template.label}" template to ${csvRows.length} recipient${csvRows.length === 1 ? '' : 's'} from ${csvFileName}. This cannot be undone.`,
			confirmWord: 'send',
			confirmLabel: 'Send emails'
		});
		if (!ok) return;

		sending = true;
		sendComplete = false;
		sentCount = 0;
		sendFailures = [];
		sendError = '';
		const rows = $state.snapshot(csvRows);
		const fields = $state.snapshot(fieldValues);
		try {
			for (let i = 0; i < rows.length; i += CAMPAIGN_BATCH_SIZE) {
				const result = await sendCampaignEmails({
					template: selectedTemplateKey,
					subject,
					fields,
					rows: rows.slice(i, i + CAMPAIGN_BATCH_SIZE),
					emailColumn
				});
				sentCount += result.sent;
				sendFailures = [...sendFailures, ...result.failures];
			}
			sendComplete = true;
		} catch (err) {
			sendError = getErrorMessage(err, 'Failed to send emails');
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Emails</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Tabs -->
	<div class="flex h-10 shrink-0 items-center gap-0 overflow-x-auto border-b border-border">
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'vmTypes'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin')}
		>
			<Cpu class="size-4 shrink-0" />
			VM Types
			<Badge variant="secondary" class="text-[10px]">{admin.vmTypes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'vms'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/vms')}
		>
			<Server class="size-4 shrink-0" />
			VMs
			<Badge variant="secondary" class="text-[10px]">
				{admin.adminVms.filter((vm) => vm.active).length}
			</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'images'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/images')}
		>
			<Disc class="size-4 shrink-0" />
			Images
			<Badge variant="secondary" class="text-[10px]">{admin.images.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'features'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/features')}
		>
			<Flag class="size-4 shrink-0" />
			Feature Flags
			<Badge variant="secondary" class="text-[10px]">
				{featureFlagKeys.filter((key) => admin.featureFlags[key]).length}
			</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'ipam'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/ipam')}
		>
			<Network class="size-4 shrink-0" />
			IPAM
			<Badge variant="secondary" class="text-[10px]">{admin.ipamPrefixes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'users'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/users')}
		>
			<UserCog class="size-4 shrink-0" />
			Users
			<Badge variant="secondary" class="text-[10px]">{userCount}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'emails'
				? 'border-red-500 text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'}"
			href={resolve('/admin/emails')}
		>
			<Mail class="size-4 shrink-0" />
			Emails
		</a>
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-auto">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5">
			<!-- Template -->
			<div class="flex flex-wrap gap-1.5">
				{#each campaignTemplates as entry (entry.key)}
					<button
						type="button"
						title={entry.description}
						class="border px-3 py-1.5 text-xs font-medium transition-colors {selectedTemplateKey ===
						entry.key
							? 'border-red-500 bg-red-950/20 text-foreground'
							: 'border-border text-muted-foreground hover:border-ring hover:text-foreground'}"
						onclick={() => selectTemplate(entry.key)}
						disabled={sending}
					>
						{entry.label}
					</button>
				{/each}
			</div>

			<!-- Editor -->
			<div class="flex flex-col gap-3">
				<div class="flex items-center gap-3 border border-border bg-background px-3">
					<span class="shrink-0 text-xs font-medium text-muted-foreground">Subject</span>
					<input
						bind:value={subject}
						placeholder="Subject line"
						disabled={sending}
						class="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
					/>
				</div>
				{#if settingsFields.length > 0}
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{#each settingsFields as field (template.key + field.name)}
							<div class="flex flex-col gap-1.5">
								<Label>
									{field.label}
									{#if !field.required}<span class="font-normal text-muted-foreground"
											>(optional)</span
										>{/if}
								</Label>
								<Input
									bind:value={fieldValues[field.name]}
									placeholder={field.placeholder}
									disabled={sending}
									oninput={scheduleEditorRefresh}
								/>
							</div>
						{/each}
					</div>
				{/if}
				{#if editorError}
					<div
						class="flex items-center justify-between gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<span class="flex items-center gap-2">
							<AlertTriangle class="size-4 shrink-0" />{editorError}
						</span>
						<Button variant="outline" size="sm" class="h-6 text-xs" onclick={() => loadEditor()}>
							Retry
						</Button>
					</div>
				{/if}
				<div class="relative min-h-48 border border-border bg-background">
					{#if editorHtml}
						{#key editorHtml}
							<div class="email-editor px-4" use:hydrateFields>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html editorHtml}
							</div>
						{/key}
					{/if}
					{#if editorLoading}
						<div class="absolute inset-0 flex items-center justify-center bg-background/60">
							<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">
					Click the outlined text in the email to edit it in place. Use <span
						class="font-mono text-muted-foreground">{'{{column}}'}</span
					>
					to pull values from the CSV. HTML tags like
					<span class="font-mono text-muted-foreground">{'<a href="...">link</a>'}</span> render in the
					sent email — check them with Preview.
				</p>
				{#if missingColumns.length > 0}
					<div
						class="flex items-center gap-2 border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
					>
						<AlertTriangle class="size-4 shrink-0" />
						No CSV column matches {missingColumns.map((name) => `{{${name}}}`).join(', ')} — those placeholders
						will be blank.
					</div>
				{/if}
			</div>

			<!-- Recipients -->
			<div class="flex flex-col gap-3">
				<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
					>Recipients</span
				>
				<div class="flex flex-col gap-2">
					<Label>
						CSV file <span class="font-normal text-muted-foreground">(first row is the header)</span
						>
					</Label>
					<Input type="file" accept=".csv,text/csv" onchange={handleCsvChange} disabled={sending} />
				</div>
				{#if csvError}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertTriangle class="size-4 shrink-0" />{csvError}
					</div>
				{/if}
				{#if csvRows.length > 0}
					<div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						<Users class="size-4 text-muted-foreground" />
						{csvFileName} · {csvRows.length} recipient{csvRows.length === 1 ? '' : 's'} ·
						{#each csvColumns as column (column)}
							<Badge variant="secondary" class="font-mono text-[10px]">{`{{${column}}}`}</Badge>
						{/each}
					</div>
					<div class="flex flex-col gap-2">
						<Label>Email column</Label>
						<select
							bind:value={emailColumn}
							disabled={sending}
							class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
						>
							<option value="">Select the column with email addresses</option>
							{#each csvColumns as column (column)}
								<option value={column}>{column}</option>
							{/each}
						</select>
					</div>
					<div class="overflow-x-auto border border-border">
						<table class="w-full whitespace-nowrap">
							<thead>
								<tr class="border-b border-border">
									{#each csvColumns as column (column)}
										<th class="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
											{column}
											{#if column === emailColumn}
												<Badge variant="secondary" class="ml-1 text-[10px]">email</Badge>
											{/if}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody class="divide-y divide-border/50">
								{#each csvRows.slice(0, 5) as row, index (index)}
									<tr>
										{#each csvColumns as column (column)}
											<td class="max-w-48 truncate px-3 py-2 text-xs text-muted-foreground">
												{row[column] ?? ''}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
						{#if csvRows.length > 5}
							<p class="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
								and {csvRows.length - 5} more
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Actions -->
			<div class="flex flex-col gap-3 border-t border-border pt-4">
				{#if previewError}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertTriangle class="size-4 shrink-0" />{previewError}
					</div>
				{/if}
				{#if sendError}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertTriangle class="size-4 shrink-0" />{sendError}
					</div>
				{/if}
				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						onclick={() => openPreview()}
						disabled={!canPreview}
					>
						{#if previewLoading}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Eye
								class="h-3 w-3"
							/>{/if}
						Preview{csvRows.length > 0 ? ' with first row' : ''}
					</Button>
					<Button size="sm" class="gap-1.5 text-xs" onclick={() => startSend()} disabled={!canSend}>
						{#if sending}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Send
								class="h-3 w-3"
							/>{/if}
						Send to {csvRows.length} recipient{csvRows.length === 1 ? '' : 's'}
					</Button>
				</div>
				{#if sending || sendComplete}
					<div class="flex flex-col gap-1.5">
						<div class="h-1.5 w-full bg-muted">
							<div
								class="h-full bg-red-500 transition-all"
								style="width: {csvRows.length > 0
									? Math.round((processedCount / csvRows.length) * 100)
									: 0}%"
							></div>
						</div>
						<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
							{#if sending}
								<Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
								Sending {processedCount} of {csvRows.length}...
							{:else if sendFailures.length === 0}
								<Check class="h-3 w-3 text-emerald-400" />
								Sent {sentCount} email{sentCount === 1 ? '' : 's'}.
							{:else}
								<AlertTriangle class="h-3 w-3 text-amber-400" />
								Sent {sentCount} of {csvRows.length}; {sendFailures.length} failed.
							{/if}
						</p>
					</div>
				{/if}
				{#if sendFailures.length > 0}
					<div class="max-h-48 overflow-y-auto border border-border">
						{#each sendFailures as failure, index (index)}
							<div
								class="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-1.5 last:border-b-0"
							>
								<span class="truncate font-mono text-xs text-muted-foreground"
									>{failure.recipient}</span
								>
								<span class="shrink-0 text-xs text-red-400">{failure.reason}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- Preview Dialog -->
<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Preview</Dialog.Title>
			<Dialog.Description>
				Subject: {previewSubject}
				{#if csvRows.length > 0}· rendered with the first CSV row{/if}
			</Dialog.Description>
		</Dialog.Header>
		<iframe
			sandbox=""
			srcdoc={previewHtml}
			title="Email preview"
			class="h-[480px] w-full border border-border bg-background"
		></iframe>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(.email-editor [data-field]) {
		outline: 1px dashed rgb(75 85 99 / 0.8);
		outline-offset: 2px;
		white-space: pre-wrap;
		cursor: text;
		transition: outline-color 120ms;
	}

	:global(.email-editor [data-field]:hover) {
		outline-color: rgb(156 163 175);
	}

	:global(.email-editor [data-field]:focus) {
		outline: 1px solid rgb(239 68 68);
	}

	:global(.email-editor [data-field]:empty::before) {
		content: attr(data-placeholder);
		color: rgb(107 114 128);
	}
</style>
