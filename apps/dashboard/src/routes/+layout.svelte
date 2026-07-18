<script lang="ts">
	import './layout.css';
	import NavigationProgress from '$lib/components/navigation-progress.svelte';
	import { onMount } from 'svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { dashboardBrand } from '$lib/branding';

	let { children } = $props();

	onMount(async () => {
		document.documentElement.dataset.brand = dashboardBrand.id;

		if (!dashboardBrand.plausibleDomain) return;

		const { init } = await import('@plausible-analytics/tracker');
		init({
			domain: dashboardBrand.plausibleDomain,
			endpoint: 'https://plausible.fyralabs.com/api/event',
			outboundLinks: true
		});
	});
</script>

<svelte:head>
	<script data-brand={dashboardBrand.id}>
		document.documentElement.dataset.brand = document.currentScript?.dataset.brand ?? 'stack';
	</script>
	<link rel="icon" href={dashboardBrand.favicon} sizes="any" />
	<link rel="icon" href={dashboardBrand.favicon32} type="image/png" sizes="32x32" />
	<link rel="icon" href={dashboardBrand.favicon16} type="image/png" sizes="16x16" />
	<link rel="apple-touch-icon" href={dashboardBrand.appleTouchIcon} sizes="180x180" />
</svelte:head>

<ModeWatcher defaultMode="dark" />
<NavigationProgress />

{@render children()}
