<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	const isNotFound = $derived(page.status === 404);
	const isServerError = $derived(page.status >= 500);
	const heading = $derived(
		isNotFound ? 'Page not found' : isServerError ? 'Something went wrong' : 'Error'
	);
	const detail = $derived(
		isNotFound
			? "We couldn't find the page you're looking for."
			: isServerError
				? 'Something went wrong on our end. Please try again in a moment.'
				: (page.error?.message ?? 'Something went wrong')
	);
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
		<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>Go Home</Button>
	</div>
</div>
