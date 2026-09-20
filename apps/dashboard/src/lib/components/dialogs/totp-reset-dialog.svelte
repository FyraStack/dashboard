<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import TotpResetFlow, {
		type TotpResetCompletedChoice
	} from '$lib/components/totp-reset-flow.svelte';

	type Props = {
		open?: boolean;
		userEmail?: string | null;
		onComplete?: (choice: TotpResetCompletedChoice) => void;
	};

	let { open = $bindable(false), userEmail = null, onComplete }: Props = $props();

	function finish(choice: TotpResetCompletedChoice) {
		open = false;
		onComplete?.(choice);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Reset authenticator app</Dialog.Title>
		</Dialog.Header>

		<TotpResetFlow active={open} {userEmail} onComplete={finish} onCancel={() => (open = false)} />
	</Dialog.Content>
</Dialog.Root>
