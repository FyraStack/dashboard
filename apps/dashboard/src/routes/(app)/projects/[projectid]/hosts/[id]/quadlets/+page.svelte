<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import {
		listManagedHostQuadlets,
		type ManagedHost,
		type ManagedHostQuadletFile,
		type ManagedHostQuadletScope
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import RefreshCw from '~icons/lucide/refresh-cw';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	let scope = $state<ManagedHostQuadletScope>('user');
	let baseDir = $state<string | null>(null);
	let filesBaseDir = $state<string | null>(null);
	let files = $state<ManagedHostQuadletFile[]>([]);
	let loading = $state(false);
	let actionError = $state('');
	let loadedKey = $state('');

	const quadlets = $derived(files.filter((file) => file.quadlet));
	const companionFiles = $derived(files.filter((file) => !file.quadlet));

	$effect(() => {
		const key = `${host.id}:${scope}`;
		if (loadedKey === key) return;
		loadedKey = key;
		loadQuadlets();
	});

	async function loadQuadlets() {
		if (loading) return;
		loading = true;
		actionError = '';
		try {
			const result = await listManagedHostQuadlets({ hostId: host.id, scope });
			baseDir = result.baseDir;
			filesBaseDir = result.filesBaseDir;
			files = result.files;
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to load Quadlets.');
		} finally {
			loading = false;
		}
	}

	function editQuadlet(filename: string) {
		goto(
			`/projects/${page.params.projectid}/hosts/${host.id}/quadlets/${encodeURIComponent(filename)}?scope=${scope}`
		);
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-sm font-semibold text-foreground">Quadlets</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Manage Quadlet units and the files they reference.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex border border-border">
				{#each ['user', 'system'] as item (item)}
					<Button
						variant={scope === item ? 'default' : 'ghost'}
						size="sm"
						class="h-8 rounded-none px-3 text-xs"
						onclick={() => {
							scope = item as ManagedHostQuadletScope;
						}}
					>
						{item}
					</Button>
				{/each}
			</div>
			<Button variant="outline" size="sm" class="gap-2" onclick={loadQuadlets} disabled={loading}>
				{#if loading}
					<Loader2 class="size-3.5 animate-spin" />
				{:else}
					<RefreshCw class="size-3.5" />
				{/if}
				Refresh
			</Button>
			<Button
				size="sm"
				class="gap-2"
				onclick={() =>
					goto(`/projects/${page.params.projectid}/hosts/${host.id}/quadlets/create?scope=${scope}`)}
			>
				<Plus class="size-3.5" />
				New
			</Button>
		</div>
	</div>

	{#if baseDir}
		<div class="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
			<p>Units: {baseDir}</p>
			{#if filesBaseDir}
				<p>Files: {filesBaseDir}</p>
			{/if}
		</div>
	{/if}

	{#if actionError}
		<div class="mt-4 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			{actionError}
		</div>
	{/if}

	<div class="mt-5 overflow-hidden border border-border">
		{#if loading && files.length === 0}
			<div class="flex items-center gap-2 p-4 text-xs text-muted-foreground">
				<Loader2 class="size-3.5 animate-spin" />
				Loading Quadlets
			</div>
		{:else if quadlets.length === 0}
			<div class="p-4 text-xs text-muted-foreground">No Quadlet units found.</div>
		{:else}
			<div class="overflow-auto">
				<table class="w-full min-w-[640px] text-left text-xs">
					<thead class="border-b border-border bg-muted/30 text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">Unit</th>
							<th class="px-3 py-2 font-medium">Path</th>
							<th class="px-3 py-2 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each quadlets as file (file.filename)}
							<tr>
								<td class="px-3 py-2 font-medium text-foreground">{file.filename}</td>
								<td class="max-w-96 px-3 py-2 font-mono text-muted-foreground">
									<span class="block truncate">{file.path ?? baseDir ?? 'Unknown'}</span>
								</td>
								<td class="px-3 py-2 text-right">
									<Button
										variant="outline"
										size="sm"
										class="h-7 px-2 text-[11px]"
										onclick={() => editQuadlet(file.filename)}
									>
										Edit
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	{#if companionFiles.length > 0}
		<section class="mt-5">
			<h2 class="text-sm font-semibold text-foreground">Companion Files</h2>
			<div class="mt-3 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2">
				{#each companionFiles as file (file.filename)}
					<div class="min-w-0 bg-background p-3">
						<p class="truncate font-mono text-xs text-foreground">{file.filename}</p>
						<p class="mt-1 truncate font-mono text-[11px] text-muted-foreground">
							{file.path ?? filesBaseDir ?? 'Unknown'}
						</p>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</section>
