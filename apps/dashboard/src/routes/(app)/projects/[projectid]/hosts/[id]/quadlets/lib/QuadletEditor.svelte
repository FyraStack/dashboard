<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		saveManagedHostQuadlet,
		type ManagedHost,
		type ManagedHostQuadletCompanionFile,
		type ManagedHostQuadletDetail,
		type ManagedHostQuadletScope
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import Trash2 from '~icons/nucleo/trash';
	import { untrack } from 'svelte';

	type EditorFile = ManagedHostQuadletCompanionFile & { id: string };

	type ParamRow = {
		id: string;
		line: number;
		section: string;
		key: string;
		value: string;
	};

	type Props = {
		host: ManagedHost;
		detail?: ManagedHostQuadletDetail | null;
		initialScope?: ManagedHostQuadletScope;
	};

	let { host, detail = null, initialScope = 'user' }: Props = $props();
	let scope = $state<ManagedHostQuadletScope>(untrack(() => detail?.scope ?? initialScope));
	let filename = $state(untrack(() => detail?.filename ?? 'demo-web.container'));
	let contents = $state(
		untrack(
			() =>
				detail?.contents ??
				'[Unit]\nDescription=Demo web site\n\n[Container]\nImage=docker.io/library/nginx:alpine\nContainerName=demo-web\nPublishPort=8080:80\nVolume=/var/lib/tetra/quadlets/demo-web:/usr/share/nginx/html:ro\n\n[Service]\nRestart=always\n\n[Install]\nWantedBy=default.target\n'
		)
	);
	let files = $state<EditorFile[]>(
		untrack(() =>
			(
				detail?.files ?? [
					{
						filename: 'index.html',
						contents:
							'<!doctype html>\n<title>Demo Web</title>\n<h1>Hello from a Quadlet companion file</h1>\n'
					}
				]
			).map((file, index) => ({ ...file, id: `file-${index}-${file.filename}` }))
		)
	);
	let saving = $state(false);
	let actionError = $state('');
	let saved = $state(false);

	const parameters = $derived(parseParameters(contents));

	function parseParameters(value: string): ParamRow[] {
		let section = '';
		const rows: ParamRow[] = [];
		value.split('\n').forEach((line, index) => {
			const trimmed = line.trim();
			const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
			if (sectionMatch) {
				section = sectionMatch[1];
				return;
			}

			if (!section || trimmed.startsWith('#') || trimmed.startsWith(';')) return;
			const keyValueMatch = line.match(/^([^=\s][^=]*)=(.*)$/);
			if (!keyValueMatch) return;
			const key = keyValueMatch[1].trim();
			rows.push({
				id: `${index}-${section}-${key}`,
				line: index,
				section,
				key,
				value: keyValueMatch[2]
			});
		});
		return rows;
	}

	function updateParameter(row: ParamRow, value: string) {
		const lines = contents.split('\n');
		lines[row.line] = `${row.key}=${value}`;
		contents = lines.join('\n');
		saved = false;
	}

	function updateFile(id: string, field: 'filename' | 'contents', value: string) {
		files = files.map((file) => (file.id === id ? { ...file, [field]: value } : file));
		saved = false;
	}

	function addFile() {
		files = [
			...files,
			{
				id: `file-${Date.now()}`,
				filename: 'file.txt',
				contents: ''
			}
		];
		saved = false;
	}

	function removeFile(id: string) {
		files = files.filter((file) => file.id !== id);
		saved = false;
	}

	async function save() {
		if (saving) return;
		saving = true;
		actionError = '';
		try {
			await saveManagedHostQuadlet({
				hostId: host.id,
				scope,
				filename,
				contents,
				filesJson: JSON.stringify(
					files
						.filter((file) => file.filename.trim())
						.map((file) => ({ filename: file.filename.trim(), contents: file.contents }))
				)
			});
			saved = true;
			await goto(
				`/projects/${page.params.projectid}/hosts/${host.id}/quadlets/${encodeURIComponent(filename)}`
			);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to save Quadlet bundle.');
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-5">
	<div class="grid gap-4 lg:grid-cols-[16rem_1fr]">
		<div class="space-y-2">
			<Label for="quadlet-scope">Scope</Label>
			<select
				id="quadlet-scope"
				class="h-9 w-full border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				bind:value={scope}
				onchange={() => (saved = false)}
			>
				<option value="user">User</option>
				<option value="system">System</option>
			</select>
		</div>
		<div class="space-y-2">
			<Label for="quadlet-filename">Quadlet filename</Label>
			<Input
				id="quadlet-filename"
				class="font-mono"
				bind:value={filename}
				oninput={() => (saved = false)}
			/>
		</div>
	</div>

	{#if detail?.filesBaseDir}
		<p class="font-mono text-xs text-muted-foreground">Files: {detail.filesBaseDir}</p>
	{/if}

	<div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
		<section class="min-w-0">
			<div class="flex items-center justify-between gap-3">
				<Label for="quadlet-contents">Quadlet specification</Label>
				<Button size="sm" class="gap-2" onclick={save} disabled={saving}>
					{#if saving}
						<Loader2 class="size-3.5 animate-spin" />
					{/if}
					{saved ? 'Saved' : 'Save'}
				</Button>
			</div>
			<Textarea
				id="quadlet-contents"
				class="mt-2 min-h-[28rem] font-mono text-xs leading-relaxed"
				bind:value={contents}
				oninput={() => (saved = false)}
			/>
		</section>

		<section class="min-w-0">
			<h2 class="text-sm font-semibold text-foreground">Parameters</h2>
			<div class="mt-3 max-h-[30rem] space-y-3 overflow-auto border border-border p-3">
				{#if parameters.length === 0}
					<p class="text-xs text-muted-foreground">No editable key/value parameters found.</p>
				{:else}
					{#each parameters as parameter (parameter.id)}
						<div class="space-y-1">
							<Label for={`param-${parameter.id}`} class="text-[11px]">
								{parameter.section}.{parameter.key}
							</Label>
							<Input
								id={`param-${parameter.id}`}
								class="h-8 font-mono text-xs"
								value={parameter.value}
								oninput={(event) => updateParameter(parameter, event.currentTarget.value)}
							/>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	</div>

	<section>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-foreground">Companion Files</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Files are written under the mutable bundle data directory, for example
					/var/lib/tetra/quadlets/demo-web.
				</p>
			</div>
			<Button variant="outline" size="sm" class="gap-2" onclick={addFile}>
				<Plus class="size-3.5" />
				Add file
			</Button>
		</div>

		<div class="mt-3 grid gap-3">
			{#each files as file (file.id)}
				<div class="border border-border p-3">
					<div class="flex gap-2">
						<div class="min-w-0 flex-1 space-y-2">
							<Label for={`file-name-${file.id}`}>Filename</Label>
							<Input
								id={`file-name-${file.id}`}
								class="font-mono text-xs"
								value={file.filename}
								oninput={(event) => updateFile(file.id, 'filename', event.currentTarget.value)}
							/>
						</div>
						<Button
							variant="outline"
							size="sm"
							aria-label="Remove companion file"
							class="mt-7 h-9 w-9 shrink-0 p-0 text-destructive dark:text-red-300"
							onclick={() => removeFile(file.id)}
						>
							<Trash2 class="size-3.5" />
						</Button>
					</div>
					<div class="mt-3 space-y-2">
						<Label for={`file-contents-${file.id}`}>Contents</Label>
						<Textarea
							id={`file-contents-${file.id}`}
							class="min-h-40 font-mono text-xs leading-relaxed"
							value={file.contents}
							oninput={(event) => updateFile(file.id, 'contents', event.currentTarget.value)}
						/>
					</div>
				</div>
			{/each}
		</div>
	</section>

	{#if actionError}
		<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			{actionError}
		</div>
	{/if}
</div>
