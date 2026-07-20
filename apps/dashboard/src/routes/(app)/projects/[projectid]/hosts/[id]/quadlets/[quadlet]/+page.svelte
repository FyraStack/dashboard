<script lang="ts">
	import { page } from '$app/state';
	import {
		getManagedHostQuadlet,
		type ManagedHost,
		type ManagedHostQuadletDetail,
		type ManagedHostQuadletScope
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import QuadletEditor from '../lib/QuadletEditor.svelte';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	const filename = $derived(decodeURIComponent(page.params.quadlet ?? ''));
	const scope = $derived<ManagedHostQuadletScope>(
		page.url.searchParams.get('scope') === 'system' ? 'system' : 'user'
	);
	let detail = $state<ManagedHostQuadletDetail | null>(null);
	let loading = $state(false);
	let actionError = $state('');
	let loadedKey = $state('');

	$effect(() => {
		const key = `${host.id}:${scope}:${filename}`;
		if (!filename || loadedKey === key) return;
		loadedKey = key;
		loadQuadlet();
	});

	async function loadQuadlet() {
		if (loading) return;
		loading = true;
		actionError = '';
		try {
			detail = await getManagedHostQuadlet({
				hostId: host.id,
				scope,
				filename
			});
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to load Quadlet bundle.');
		} finally {
			loading = false;
		}
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div>
		<h1 class="text-sm font-semibold text-foreground">{filename}</h1>
		<p class="mt-1 text-xs text-muted-foreground">
			Edit the Quadlet specification, parameters, and companion files.
		</p>
	</div>

	{#if actionError}
		<div class="mt-4 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			{actionError}
		</div>
	{/if}

	{#if loading && !detail}
		<div class="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
			<Loader2 class="size-3.5 animate-spin" />
			Loading Quadlet
		</div>
	{:else if detail}
		<div class="mt-5">
			<QuadletEditor {host} {detail} initialScope={scope} />
		</div>
	{/if}
</section>
