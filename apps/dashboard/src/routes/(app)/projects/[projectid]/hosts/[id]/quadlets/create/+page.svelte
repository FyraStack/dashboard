<script lang="ts">
	import { page } from '$app/state';
	import type { ManagedHost, ManagedHostQuadletScope } from '$lib/remote/managed-hosts.remote';
	import QuadletEditor from '../lib/QuadletEditor.svelte';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	const initialScope = $derived<ManagedHostQuadletScope>(
		page.url.searchParams.get('scope') === 'system' ? 'system' : 'user'
	);
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div>
		<h1 class="text-sm font-semibold text-foreground">New Quadlet</h1>
		<p class="mt-1 text-xs text-muted-foreground">
			Create a Quadlet unit with companion files in the host's mutable data directory.
		</p>
	</div>

	<div class="mt-5">
		<QuadletEditor {host} {initialScope} />
	</div>
</section>
