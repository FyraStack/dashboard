<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { initPlausible } from '#lib/analytics/plausible.js';
	import { initPostHog } from '#lib/analytics/posthog.js';
	import NavigationProgress from '#lib/components/navigation-progress.svelte';
	import { contrast } from '#lib/state/contrast.svelte.js';

	let { children } = $props();

	onMount(() => {
		initPostHog();
		initPlausible();
	});

	$effect(() => {
		contrast.apply();
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
	<link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
</svelte:head>

<svelte:window onstorage={(event) => contrast.syncFromStorage(event)} />

<ModeWatcher defaultMode="dark" />
<NavigationProgress />

{@render children()}
