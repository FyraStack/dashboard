<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { useErrorPage } from '#lib/error-page.svelte.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const errorPage = useErrorPage();
</script>

<svelte:head>
	<title>{errorPage.status} / Stack</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
	<p class="text-4xl font-bold text-foreground">{errorPage.status}</p>
	<div class="space-y-1">
		<p class="text-sm font-medium text-foreground">{errorPage.heading}</p>
		<p class="max-w-sm text-sm text-muted-foreground">{errorPage.detail}</p>
	</div>
	<div class="mt-2 flex items-center gap-2">
		{#if !errorPage.isNotFound}
			<Button variant="outline" size="sm" onclick={() => location.reload()}>Try again</Button>
		{/if}
		<Button variant="outline" size="sm" onclick={() => goto(resolve(''))}>Go Home</Button>
	</div>
</div>
