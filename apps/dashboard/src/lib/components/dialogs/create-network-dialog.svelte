<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		open = $bindable(false),
		name = $bindable(''),
		cidr = $bindable('10.0.0.0/16'),
		onSubmit
	}: {
		open?: boolean;
		name?: string;
		cidr?: string;
		onSubmit: () => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Private Network</Dialog.Title>
			<Dialog.Description>Create an isolated network for your servers.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Name</Label>
				<Input bind:value={name} placeholder="my-network" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>CIDR Block</Label>
				<Input bind:value={cidr} placeholder="10.0.0.0/16" />
				<p class="text-xs text-gray-500">Private IPv4 range. Must not overlap existing networks.</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
			<Button size="sm" onclick={onSubmit} disabled={!name.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
