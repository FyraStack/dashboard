<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		open = $bindable(false),
		volumeName,
		server = $bindable(''),
		serverOptions,
		submitting = false,
		onSubmit
	}: {
		open?: boolean;
		volumeName?: string | null;
		server?: string;
		serverOptions: string[];
		submitting?: boolean;
		onSubmit: () => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Attach Volume</Dialog.Title>
			<Dialog.Description>Attach {volumeName ?? 'this volume'} to a server.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2 py-4">
			<Label>Server</Label>
			<select
				bind:value={server}
				class="w-full appearance-none border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
			>
				{#each serverOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)} disabled={submitting}
				>Cancel</Button
			>
			<Button size="sm" onclick={onSubmit} disabled={submitting || !server}
				>{submitting ? 'Attaching...' : 'Attach'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
