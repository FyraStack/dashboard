<script lang="ts">
	let { title }: { title: string } = $props();

	const MAX_LEN = 40;
	const formatted = $derived(title.length > MAX_LEN ? title.slice(0, MAX_LEN - 1) + '…' : title);
</script>

<svelte:head>
	<title>{formatted} / Stack</title>
</svelte:head>
