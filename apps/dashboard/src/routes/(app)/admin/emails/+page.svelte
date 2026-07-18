<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { confirmDestructive } from '$lib/confirm.svelte';
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
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Eye from '~icons/nucleo/eye';
	import Send from '~icons/nucleo/send';
	import Users from '~icons/nucleo/users';

	let { data }: { data: AdminPageData } = $props();
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

	const recipientColumns = ['name', 'email'];

	const activeVmsByOwnerEmail = $derived.by(() => {
		const map = new Map<string, { count: number; types: Set<string> }>();
		for (const vm of admin.adminVms) {
			if (!vm.active || !vm.ownerEmail) continue;
			const entry = map.get(vm.ownerEmail) ?? { count: 0, types: new Set<string>() };
			entry.count += 1;
			if (vm.vmTypeName) entry.types.add(vm.vmTypeName);
			map.set(vm.ownerEmail, entry);
		}
		return map;
	});
	const vmTypeOptions = $derived(
		[
			...new Set(
				admin.adminVms.filter((vm) => vm.active && vm.vmTypeName).map((vm) => vm.vmTypeName!)
			)
		].sort()
	);

	type AudienceField =
		'signedUp' | 'vmCount' | 'vmType' | 'verified' | 'billingExempt' | 'disabled';
	type AudienceCondition = { field: AudienceField; op: string; value: string };

	const audienceFieldDefs: Record<
		AudienceField,
		{ label: string; ops: { value: string; label: string }[] }
	> = {
		signedUp: {
			label: 'Signed up',
			ops: [
				{ value: 'before', label: 'before' },
				{ value: 'after', label: 'after' }
			]
		},
		vmCount: {
			label: 'Active VMs',
			ops: [
				{ value: 'gte', label: 'at least' },
				{ value: 'eq', label: 'exactly' }
			]
		},
		vmType: {
			label: 'Owns VM type',
			ops: [
				{ value: 'is', label: 'is' },
				{ value: 'not', label: 'is not' }
			]
		},
		verified: { label: 'Email verified', ops: [{ value: 'is', label: 'is' }] },
		billingExempt: { label: 'Billing exempt', ops: [{ value: 'is', label: 'is' }] },
		disabled: { label: 'Disabled', ops: [{ value: 'is', label: 'is' }] }
	};

	function defaultCondition(field: AudienceField): AudienceCondition {
		if (field === 'signedUp') return { field, op: 'before', value: '' };
		if (field === 'vmCount') return { field, op: 'gte', value: '1' };
		if (field === 'vmType') return { field, op: 'is', value: vmTypeOptions[0] ?? '' };
		return { field, op: 'is', value: 'yes' };
	}

	let audienceConditions = $state<AudienceCondition[]>([defaultCondition('vmCount')]);

	const queryRecipients = $derived(
		admin.adminUsers.filter((account) =>
			audienceConditions.every((condition) => {
				const owned = activeVmsByOwnerEmail.get(account.email);
				switch (condition.field) {
					case 'signedUp': {
						if (!condition.value) return true;
						const cutoff = new Date(condition.value).getTime();
						if (Number.isNaN(cutoff)) return true;
						const created = new Date(account.createdAt).getTime();
						return condition.op === 'before' ? created < cutoff : created > cutoff;
					}
					case 'vmCount': {
						const target = Number.parseInt(condition.value, 10);
						if (Number.isNaN(target)) return true;
						const ownedCount = owned?.count ?? 0;
						return condition.op === 'gte' ? ownedCount >= target : ownedCount === target;
					}
					case 'vmType': {
						if (!condition.value) return true;
						const hasType = owned?.types.has(condition.value) ?? false;
						return condition.op === 'is' ? hasType : !hasType;
					}
					case 'verified':
						return account.emailVerified === (condition.value === 'yes');
					case 'billingExempt':
						return account.billingExempt === (condition.value === 'yes');
					case 'disabled':
						return account.disabled === (condition.value === 'yes');
				}
			})
		)
	);
	const queryLabel = $derived(
		audienceConditions.length === 0
			? 'All users'
			: audienceConditions
					.map((condition) => {
						const def = audienceFieldDefs[condition.field];
						const op = def.ops.find((entry) => entry.value === condition.op)?.label ?? condition.op;
						return `${def.label} ${op} ${condition.value}`.trim();
					})
					.join(' and ')
	);
	const recipientRows = $derived(
		queryRecipients.map((account) => ({ name: account.name, email: account.email }))
	);

	const usedPlaceholders = $derived([
		...new Set(
			[subject, ...template.fields.map((field) => fieldValues[field.name] ?? '')].flatMap(
				extractPlaceholders
			)
		)
	]);
	const missingColumns = $derived(
		recipientRows.length > 0
			? usedPlaceholders.filter((placeholder) => !recipientColumns.includes(placeholder))
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
				row: $state.snapshot(recipientRows)[0] ?? {}
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
		!sending && recipientRows.length > 0 && subject.trim() !== '' && fieldsComplete
	);
	const processedCount = $derived(sentCount + sendFailures.length);

	async function startSend() {
		if (!canSend) return;
		const ok = await confirmDestructive({
			title: 'Send emails',
			description: `This sends the "${template.label}" template to ${recipientRows.length} recipient${recipientRows.length === 1 ? '' : 's'} (${queryLabel}). This cannot be undone.`,
			confirmWord: 'send',
			confirmLabel: 'Send emails'
		});
		if (!ok) return;

		sending = true;
		sendComplete = false;
		sentCount = 0;
		sendFailures = [];
		sendError = '';
		const rows = $state.snapshot(recipientRows);
		const fields = $state.snapshot(fieldValues);
		try {
			for (let i = 0; i < rows.length; i += CAMPAIGN_BATCH_SIZE) {
				const result = await sendCampaignEmails({
					template: selectedTemplateKey,
					subject,
					fields,
					rows: rows.slice(i, i + CAMPAIGN_BATCH_SIZE),
					emailColumn: 'email'
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
							{#if field.options}
								<select
									bind:value={fieldValues[field.name]}
									disabled={sending}
									onchange={scheduleEditorRefresh}
									class="h-9 w-full border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
								>
									{#each field.options as option (option.value)}
										<option value={option.value}>{option.label}</option>
									{/each}
								</select>
							{:else}
								<Input
									bind:value={fieldValues[field.name]}
									placeholder={field.placeholder}
									disabled={sending}
									oninput={scheduleEditorRefresh}
								/>
							{/if}
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
				to pull values from the audience columns (name, email). HTML tags like
				<span class="font-mono text-muted-foreground">{'<a href="...">link</a>'}</span> render in the
				sent email. Check them with Preview.
			</p>
			{#if missingColumns.length > 0}
				<div
					class="flex items-center gap-2 border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
				>
					<AlertTriangle class="size-4 shrink-0" />
					No audience column matches {missingColumns.map((name) => `{{${name}}}`).join(', ')}, so
					those placeholders will be blank.
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-3">
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
				>Recipients</span
			>
			<div class="flex flex-col gap-2">
				{#each audienceConditions as condition, index (index)}
					<div class="flex flex-wrap items-center gap-2">
						{#if index > 0}
							<span class="w-8 text-right text-[11px] text-muted-foreground">and</span>
						{:else}
							<span class="w-8 text-right text-[11px] text-muted-foreground">where</span>
						{/if}
						<select
							value={condition.field}
							onchange={(event) =>
								(audienceConditions[index] = defaultCondition(
									event.currentTarget.value as AudienceField
								))}
							disabled={sending}
							class="h-8 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
						>
							{#each Object.entries(audienceFieldDefs) as [value, def] (value)}
								<option {value}>{def.label}</option>
							{/each}
						</select>
						<select
							bind:value={condition.op}
							disabled={sending}
							class="h-8 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
						>
							{#each audienceFieldDefs[condition.field].ops as op (op.value)}
								<option value={op.value}>{op.label}</option>
							{/each}
						</select>
						{#if condition.field === 'signedUp'}
							<input
								type="date"
								bind:value={condition.value}
								disabled={sending}
								class="h-8 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
							/>
						{:else if condition.field === 'vmCount'}
							<input
								type="number"
								min="0"
								bind:value={condition.value}
								disabled={sending}
								class="h-8 w-20 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
							/>
						{:else if condition.field === 'vmType'}
							<select
								bind:value={condition.value}
								disabled={sending}
								class="h-8 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
							>
								{#each vmTypeOptions as typeName (typeName)}
									<option value={typeName}>{typeName}</option>
								{/each}
							</select>
						{:else}
							<select
								bind:value={condition.value}
								disabled={sending}
								class="h-8 border border-border bg-muted px-2 text-xs text-foreground focus:border-ring focus:outline-none"
							>
								<option value="yes">yes</option>
								<option value="no">no</option>
							</select>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
							onclick={() =>
								(audienceConditions = audienceConditions.filter((_, i) => i !== index))}
							disabled={sending}
							aria-label="Remove condition"
						>
							<X class="h-3.5 w-3.5" />
						</Button>
					</div>
				{/each}
				<Button
					variant="outline"
					size="sm"
					class="w-fit gap-1.5 border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() =>
						(audienceConditions = [...audienceConditions, defaultCondition('verified')])}
					disabled={sending}
				>
					<Plus class="h-3 w-3" />
					Add condition
				</Button>
			</div>
			<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Users class="size-4 text-muted-foreground" />
				{queryRecipients.length} recipient{queryRecipients.length === 1 ? '' : 's'} matched
			</div>
			{#if queryRecipients.length > 0}
				<div class="max-h-48 overflow-y-auto border border-border">
					{#each queryRecipients as recipient (recipient.id)}
						<div
							class="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-1.5 last:border-b-0"
						>
							<span class="truncate text-xs text-foreground">{recipient.name}</span>
							<span class="shrink-0 font-mono text-xs text-muted-foreground">{recipient.email}</span
							>
						</div>
					{/each}
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
					Preview{recipientRows.length > 0 ? ' with first row' : ''}
				</Button>
				<Button size="sm" class="gap-1.5 text-xs" onclick={() => startSend()} disabled={!canSend}>
					{#if sending}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Send class="h-3 w-3" />{/if}
					Send to {recipientRows.length} recipient{recipientRows.length === 1 ? '' : 's'}
				</Button>
			</div>
			{#if sending || sendComplete}
				<div class="flex flex-col gap-1.5">
					<div class="h-1.5 w-full bg-muted">
						<div
							class="h-full bg-red-500 transition-all"
							style="width: {recipientRows.length > 0
								? Math.round((processedCount / recipientRows.length) * 100)
								: 0}%"
						></div>
					</div>
					<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
						{#if sending}
							<Loader2 class="h-3 w-3 animate-spin text-muted-foreground" />
							Sending {processedCount} of {recipientRows.length}...
						{:else if sendFailures.length === 0}
							<Check class="h-3 w-3 text-emerald-400" />
							Sent {sentCount} email{sentCount === 1 ? '' : 's'}.
						{:else}
							<AlertTriangle class="h-3 w-3 text-amber-400" />
							Sent {sentCount} of {recipientRows.length}; {sendFailures.length} failed.
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

<!-- Preview Dialog -->
<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Preview</Dialog.Title>
			<Dialog.Description>
				Subject: {previewSubject}
				{#if recipientRows.length > 0}· rendered with the first recipient{/if}
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
