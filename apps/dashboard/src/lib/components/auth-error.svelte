<script lang="ts">
	import type { Snippet } from 'svelte';
	import AlertCircle from '~icons/nucleo/alert-circle';

	let { children }: { children: Snippet } = $props();
</script>

<div
	class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
>
	<AlertCircle class="size-4 shrink-0" />
	{@render children()}
</div>
