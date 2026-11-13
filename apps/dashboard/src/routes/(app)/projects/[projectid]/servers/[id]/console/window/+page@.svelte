<script lang="ts">
	import { getVm } from '#lib/remote/vms.remote.js';
	import { toServerInfo } from '#lib/server-info.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { page } from '$app/state';
	import Loader2 from '~icons/lucide/loader-2';
	import TerminalIcon from '~icons/nucleo/terminal';
	import SerialConsole from '../serial-console.svelte';

	const STATUS_REFRESH_MS = 10_000;

	const vmQuery = $derived(getVm({ vmId: page.params.id ?? '' }));
	const server = $derived(vmQuery.current ? toServerInfo(vmQuery.current) : null);

	$effect(() => {
		const query = vmQuery;
		const timer = setInterval(() => {
			query.refresh().catch(() => null);
		}, STATUS_REFRESH_MS);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>{server ? `${server.name} console` : 'Console'} / Stack</title>
</svelte:head>

<div class="fixed inset-0 flex flex-col bg-background">
	{#if server}
		<SerialConsole vmId={server.id} vmName={server.name} running={server.status === 'running'} />
	{:else if vmQuery.error}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
			<TerminalIcon class="h-8 w-8 text-muted-foreground" />
			<p class="text-sm text-foreground">
				{getErrorMessage(vmQuery.error, 'This server could not be loaded')}
			</p>
		</div>
	{:else}
		<div class="flex flex-1 items-center justify-center">
			<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	{/if}
</div>
