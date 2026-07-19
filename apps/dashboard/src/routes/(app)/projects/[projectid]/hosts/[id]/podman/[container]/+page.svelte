<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		getManagedHostPodmanContainer,
		type ManagedHost,
		type ManagedHostPodmanContainerDetail
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import RefreshCw from '~icons/lucide/refresh-cw';
	import Trash2 from '~icons/nucleo/trash';
	import { tick } from 'svelte';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	const containerName = $derived(decodeURIComponent(page.params.container ?? ''));
	let container = $state<ManagedHostPodmanContainerDetail | null>(null);
	let loading = $state(false);
	let actionError = $state('');
	let env = $state<string[]>([]);
	let binds = $state<string[]>([]);
	let ports = $state<string[]>([]);
	let draftSaved = $state(false);
	let loadedKey = $state('');

	const draftCommand = $derived(buildDraftCommand(container, env, binds, ports));

	$effect(() => {
		const key = `${host.id}:${containerName}`;
		if (!containerName || loadedKey === key) return;
		loadedKey = key;
		loadContainer();
	});

	function formatDate(value: string | null) {
		if (!value) return 'Unknown';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	function updateList(list: string[], index: number, value: string) {
		const next = [...list];
		next[index] = value;
		draftSaved = false;
		return next;
	}

	function removeListItem(list: string[], index: number) {
		draftSaved = false;
		return list.filter((_, itemIndex) => itemIndex !== index);
	}

	function addListItem(kind: 'env' | 'bind' | 'port') {
		draftSaved = false;
		if (kind === 'env') env = [...env, 'KEY=value'];
		if (kind === 'bind') binds = [...binds, '/host/path:/container/path:Z'];
		if (kind === 'port') ports = [...ports, '8080/tcp -> 0.0.0.0:8080'];
	}

	function buildDraftCommand(
		detail: ManagedHostPodmanContainerDetail | null,
		envValues: string[],
		bindValues: string[],
		portValues: string[]
	) {
		if (!detail) return '';

		const parts = ['podman run --replace', `--name ${shellQuote(detail.name)}`];
		for (const value of envValues.map((item) => item.trim()).filter(Boolean)) {
			parts.push(`--env ${shellQuote(value)}`);
		}
		for (const value of bindValues.map((item) => item.trim()).filter(Boolean)) {
			parts.push(`--volume ${shellQuote(value)}`);
		}
		for (const value of portValues.map((item) => item.trim()).filter(Boolean)) {
			const parsed = parsePortDraft(value);
			parts.push(`--publish ${shellQuote(parsed)}`);
		}
		if (detail.image) parts.push(shellQuote(detail.image));
		return parts.join(' \\\n  ');
	}

	function parsePortDraft(value: string) {
		const match = value.match(/^\s*([^ ]+)\s*->\s*([^:]+):(.+)\s*$/);
		if (!match) return value;
		const [, containerPort, hostIp, hostPort] = match;
		return `${hostIp}:${hostPort}:${containerPort}`;
	}

	function shellQuote(value: string) {
		return `'${value.replaceAll("'", "'\\''")}'`;
	}

	async function loadContainer() {
		if (loading) return;
		loading = true;
		actionError = '';
		try {
			const result = await getManagedHostPodmanContainer({
				hostId: host.id,
				name: containerName,
				lines: 300
			});
			container = result;
			env = [...result.env];
			binds = [...result.binds];
			ports = [...result.ports];
			draftSaved = false;
			await scrollToHashTarget();
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to load container.');
		} finally {
			loading = false;
		}
	}

	async function scrollToHashTarget() {
		if (page.url.hash !== '#logs') return;
		await tick();
		document.getElementById('logs')?.scrollIntoView({ block: 'start' });
	}

	function saveDraft() {
		draftSaved = true;
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div class="min-w-0">
			<p class="text-xs text-muted-foreground">Podman Container</p>
			<h1 class="mt-1 truncate text-base font-semibold text-foreground">{containerName}</h1>
		</div>
		<Button variant="outline" size="sm" class="gap-2" onclick={loadContainer} disabled={loading}>
			{#if loading}
				<Loader2 class="size-3.5 animate-spin" />
			{:else}
				<RefreshCw class="size-3.5" />
			{/if}
			Refresh
		</Button>
	</div>

	{#if actionError}
		<div class="mt-4 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			{actionError}
		</div>
	{/if}

	{#if loading && !container}
		<div class="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
			<Loader2 class="size-3.5 animate-spin" />
			Loading container
		</div>
	{:else if container}
		<div class="mt-5 grid gap-px overflow-hidden border border-border bg-border lg:grid-cols-[20rem_1fr]">
			<section class="bg-background p-4">
				<h2 class="text-sm font-semibold text-foreground">Runtime</h2>
				<div class="mt-4 divide-y divide-border border border-border">
					{#each [['State', container.state ?? 'Unknown'], ['Status', container.status ?? 'Unknown'], ['Image', container.image ?? 'Unknown'], ['Created', formatDate(container.createdAt)], ['ID', container.id ?? 'Unknown']] as [label, value] (label)}
						<div class="flex items-center justify-between gap-4 px-3 py-2">
							<span class="text-xs text-muted-foreground">{label}</span>
							<span class="truncate text-right text-xs font-medium text-foreground">{value}</span>
						</div>
					{/each}
				</div>

				{#if Object.keys(container.labels).length > 0}
					<h3 class="mt-5 text-xs font-semibold text-foreground">Labels</h3>
					<div class="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
						{#each Object.entries(container.labels) as [key, value] (key)}
							<p class="truncate">{key}={value}</p>
						{/each}
					</div>
				{/if}
			</section>

			<section class="bg-background p-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 class="text-sm font-semibold text-foreground">Configuration Draft</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							Changes here are staged for a future recreate or Quadlet workflow.
						</p>
					</div>
					<Button size="sm" onclick={saveDraft}>{draftSaved ? 'Draft saved' : 'Save draft'}</Button>
				</div>

				<div class="mt-4 grid gap-5 xl:grid-cols-3">
					<div class="space-y-3">
						<div class="flex items-center justify-between gap-2">
							<Label>Environment</Label>
							<Button variant="outline" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={() => addListItem('env')}>
								<Plus class="size-3" />
								Add
							</Button>
						</div>
						{#each env as value, index (`env-${index}`)}
							<div class="flex gap-2">
								<Input
									aria-label={`Environment variable ${index + 1}`}
									class="font-mono text-xs"
									value={value}
									oninput={(event) => (env = updateList(env, index, event.currentTarget.value))}
								/>
								<Button
									variant="outline"
									size="sm"
									aria-label="Remove environment variable"
									class="h-9 w-9 shrink-0 p-0 text-destructive"
									onclick={() => (env = removeListItem(env, index))}
								>
									<Trash2 class="size-3.5" />
								</Button>
							</div>
						{/each}
					</div>

					<div class="space-y-3">
						<div class="flex items-center justify-between gap-2">
							<Label>Volume Binds</Label>
							<Button variant="outline" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={() => addListItem('bind')}>
								<Plus class="size-3" />
								Add
							</Button>
						</div>
						{#each binds as value, index (`bind-${index}`)}
							<div class="flex gap-2">
								<Input
									aria-label={`Volume bind ${index + 1}`}
									class="font-mono text-xs"
									value={value}
									oninput={(event) => (binds = updateList(binds, index, event.currentTarget.value))}
								/>
								<Button
									variant="outline"
									size="sm"
									aria-label="Remove volume bind"
									class="h-9 w-9 shrink-0 p-0 text-destructive"
									onclick={() => (binds = removeListItem(binds, index))}
								>
									<Trash2 class="size-3.5" />
								</Button>
							</div>
						{/each}
					</div>

					<div class="space-y-3">
						<div class="flex items-center justify-between gap-2">
							<Label>Ports</Label>
							<Button variant="outline" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={() => addListItem('port')}>
								<Plus class="size-3" />
								Add
							</Button>
						</div>
						{#each ports as value, index (`port-${index}`)}
							<div class="flex gap-2">
								<Input
									aria-label={`Port mapping ${index + 1}`}
									class="font-mono text-xs"
									value={value}
									oninput={(event) => (ports = updateList(ports, index, event.currentTarget.value))}
								/>
								<Button
									variant="outline"
									size="sm"
									aria-label="Remove port mapping"
									class="h-9 w-9 shrink-0 p-0 text-destructive"
									onclick={() => (ports = removeListItem(ports, index))}
								>
									<Trash2 class="size-3.5" />
								</Button>
							</div>
						{/each}
					</div>
				</div>

				<div class="mt-5">
					<Label for="draft-command">Generated recreate command</Label>
					<Textarea
						id="draft-command"
						class="mt-2 min-h-32 font-mono text-xs"
						readonly
						value={draftCommand}
					/>
				</div>
			</section>
		</div>

		<div class="mt-5 grid gap-5 xl:grid-cols-2">
			<section id="logs" class="scroll-mt-5">
				<h2 class="text-sm font-semibold text-foreground">Logs</h2>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex - Axe requires keyboard access for this scrollable code region. -->
				<pre
					role="region"
					aria-label="Container logs"
					tabindex="0"
					class="mt-3 max-h-[30rem] overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{container.logs}</pre>
			</section>

			<section>
				<h2 class="text-sm font-semibold text-foreground">Raw Inspect</h2>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex - Axe requires keyboard access for this scrollable code region. -->
				<pre
					role="region"
					aria-label="Raw container inspect JSON"
					tabindex="0"
					class="mt-3 max-h-[30rem] overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{JSON.stringify(
						container.rawInspect,
						null,
						2
					)}</pre>
			</section>
		</div>
	{/if}
</section>
