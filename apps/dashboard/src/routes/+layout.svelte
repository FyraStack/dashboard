<script lang="ts">
	import './layout.css';
	import NavigationProgress from '$lib/components/navigation-progress.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(async () => {
		const { init } = await import('@plausible-analytics/tracker');
		init({
			domain: 'dash.fyrastack.com',
			endpoint: 'https://plausible.fyralabs.com/api/event',
			outboundLinks: true
		});
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="any" />
	<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
	<link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
</svelte:head>

<NavigationProgress />

{@render children()}
