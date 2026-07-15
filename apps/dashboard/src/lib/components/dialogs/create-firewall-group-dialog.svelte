<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		open = $bindable(false),
		name = $bindable(''),
		submitting = false,
		onSubmit
	}: {
		open?: boolean;
		name?: string;
		submitting?: boolean;
		onSubmit: () => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Firewall Group</Dialog.Title>
			<Dialog.Description>Create a new group to organize firewall rules.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Name</Label>
				<Input bind:value={name} placeholder="my-firewall" />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (open = false)} disabled={submitting}
				>Cancel</Button
			>
			<Button size="sm" onclick={onSubmit} disabled={!name.trim() || submitting}
				>{submitting ? 'Creating...' : 'Create'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
