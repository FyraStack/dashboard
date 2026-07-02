<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';

	let {
		open = $bindable(false),
		name = $bindable(''),
		size = $bindable(25),
		submitting = false,
		onSubmit
	}: {
		open?: boolean;
		name?: string;
		size?: number;
		submitting?: boolean;
		onSubmit: () => void | Promise<void>;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Volume</Dialog.Title>
			<Dialog.Description>Provision a new block storage volume in Chicago.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Name</Label>
				<Input bind:value={name} placeholder="my-volume" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>Size (GB)</Label>
				<div class="flex items-center gap-3">
					<input
						type="range"
						min="10"
						max="500"
						step="10"
						bind:value={size}
						class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-700 accent-red-500"
					/>
					<span class="w-16 text-right text-sm font-medium text-gray-200">{size} GB</span>
				</div>
				<p class="text-xs text-gray-500">${(size * 0.1).toFixed(2)}/mo at $0.10/GB</p>
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
