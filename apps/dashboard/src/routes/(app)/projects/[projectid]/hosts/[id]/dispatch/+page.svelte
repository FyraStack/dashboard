<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		dispatchManagedHostCommand,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import Send from '~icons/lucide/send';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	let moduleName = $state('settings');
	let actionName = $state('get_system');
	let payloadJson = $state('{}');
	let responseJson = $state('');
	let actionError = $state('');
	let dispatching = $state(false);

	function formatJson(value: unknown) {
		return JSON.stringify(value ?? null, null, 2);
	}

	async function dispatchCommand() {
		if (dispatching) return;
		actionError = '';
		responseJson = '';
		dispatching = true;
		try {
			const response = await dispatchManagedHostCommand({
				hostId: data.host.id,
				module: moduleName,
				action: actionName,
				payloadJson
			});
			responseJson = formatJson(response);
		} catch (err) {
			actionError = getErrorMessage(err, 'Command failed.');
		} finally {
			dispatching = false;
		}
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div>
		<h2 class="text-sm font-semibold text-foreground">Dispatch Command</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Send a Tetra command envelope through the dashboard server.
		</p>
	</div>

	<div class="mt-4 grid gap-4 lg:max-w-2xl">
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="module">Module</Label>
				<Input id="module" bind:value={moduleName} />
			</div>
			<div class="space-y-2">
				<Label for="action">Action</Label>
				<Input id="action" bind:value={actionName} />
			</div>
		</div>

		<div class="space-y-2">
			<Label for="payload">Payload JSON</Label>
			<Textarea id="payload" class="min-h-32 font-mono text-xs" bind:value={payloadJson} />
		</div>

		{#if actionError}
			<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
				{actionError}
			</div>
		{/if}

		<Button class="w-fit gap-2" onclick={dispatchCommand} disabled={dispatching}>
			{#if dispatching}
				<Loader2 class="size-4 animate-spin" />
			{:else}
				<Send class="size-4" />
			{/if}
			Dispatch
		</Button>

		{#if responseJson}
			<pre
				class="max-h-80 overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{responseJson}</pre>
		{/if}
	</div>
</section>
