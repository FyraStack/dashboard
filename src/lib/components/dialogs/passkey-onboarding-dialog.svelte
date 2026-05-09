<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Fingerprint, Loader2 } from '@lucide/svelte';

	type Props = {
		open?: boolean;
		onComplete?: () => void;
	};

	let { open = $bindable(false), onComplete }: Props = $props();

	let passkeyName = $state('');
	let registering = $state(false);
	let error = $state('');

	$effect(() => {
		if (!open) {
			passkeyName = '';
			error = '';
			registering = false;
		}
	});

	async function registerPasskey() {
		registering = true;
		error = '';
		const { error: err } = await authClient.passkey.addPasskey({
			name: passkeyName.trim() || undefined
		});
		registering = false;
		if (err) {
			error = err.message ?? 'Failed to register passkey';
			return;
		}
		open = false;
		onComplete?.();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Add Passkey</Dialog.Title>
			<Dialog.Description>
				Register a passkey for passwordless sign-in. Your browser will prompt you to authenticate.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-1.5">
				<Label>Name</Label>
				<Input
					bind:value={passkeyName}
					placeholder="My Macbook"
					onkeydown={(e) => e.key === 'Enter' && registerPasskey()}
				/>
			</div>

			{#if error}
				<p class="text-xs text-red-400">{error}</p>
			{/if}

			<Button
				onclick={registerPasskey}
				disabled={registering}
				class="gap-1.5"
			>
				{#if registering}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Registering...
				{:else}
					<Fingerprint class="h-3.5 w-3.5" />
					Register Passkey
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
