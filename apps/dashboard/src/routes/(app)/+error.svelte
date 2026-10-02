<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const isNotFound = $derived(page.status === 404);
	const isServerError = $derived(page.status >= 500);
	const heading = $derived.by(() => {
		if (isNotFound) {
			return 'Page not found';
		}
		return isServerError ? 'Something went wrong' : 'Error';
	});
	const detail = $derived.by(() => {
		if (isNotFound) {
			return "We couldn't find the page you're looking for.";
		}
		if (isServerError) {
			return 'Something went wrong on our end. Please try again in a moment.';
		}
		return page.error?.message ?? 'Something went wrong';
	});
</script>

<svelte:head>
	<title>{page.status} / Stack</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center">
	<p class="text-4xl font-bold text-foreground">{page.status}</p>
	<div class="space-y-1">
		<p class="text-sm font-medium text-foreground">{heading}</p>
		<p class="max-w-sm text-sm text-muted-foreground">{detail}</p>
	</div>
	<div class="mt-2 flex items-center gap-2">
		{#if !isNotFound}
			<Button variant="outline" size="sm" onclick={() => location.reload()}>Try again</Button>
		{/if}
		<Button variant="outline" size="sm" onclick={() => goto(resolve(''))}>Go Home</Button>
	</div>
</div>
