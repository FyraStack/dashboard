<script lang="ts">
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import { authClient } from '#lib/auth-client.js';
	import { Button } from '#lib/components/ui/button/index.js';

	let { redirectTo, onError }: { redirectTo: string; onError: (message: string) => void } =
		$props();

	let loading = $state(false);

	async function signIn() {
		if (loading) {
			return;
		}
		onError('');
		loading = true;
		try {
			const { error } = await authClient.signIn.social({
				provider: 'github',
				callbackURL: redirectTo
			});
			if (error) {
				onError(error.message ?? 'Unable to sign in.');
				loading = false;
			}
		} catch {
			onError('Unable to sign in.');
			loading = false;
		}
	}
</script>

<Button
	variant="outline"
	size="sm"
	class="w-full gap-1.5"
	{loading}
	disabled={loading}
	onclick={signIn}
>
	{#if !loading}
		<SiGithub class="h-3.5 w-3.5" color="currentColor" />
	{/if}
	GitHub
</Button>
