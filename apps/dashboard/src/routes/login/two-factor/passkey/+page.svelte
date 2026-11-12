<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '#lib/auth-client.js';
	import { authHref, goAfterAuth } from '#lib/auth-redirect.js';
	import AuthError from '#lib/components/auth-error.svelte';
	import AuthLogo from '#lib/components/auth-logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import Loader2 from '~icons/lucide/loader-2';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const redirectTo: string = $derived(data.redirectTo ?? '/');
	const loginHref = $derived(authHref('/login', redirectTo));
	const totpHref = $derived(authHref('/login/two-factor/totp', redirectTo));

	let errorMessage = $state('');
	let loading = $state(false);

	onMount(() => {
		handlePasskeySignIn();
	});

	async function handlePasskeySignIn() {
		errorMessage = '';
		loading = true;

		const { error: err } = await authClient.signIn.passkey({ autoFill: false });

		loading = false;

		if (err) {
			errorMessage = err.message ?? 'Unable to sign in with passkey.';
			return;
		}

		await goAfterAuth(redirectTo);
	}
</script>

<svelte:head>
	<title>Verify with Passkey / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<AuthLogo />

		<div class="space-y-5">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center border border-border bg-background">
					<Fingerprint class="h-5 w-5 text-red-400" />
				</div>
				<h1 class="text-lg font-medium text-foreground">Verify with Passkey</h1>
				<p class="text-center text-sm text-muted-foreground">
					Use your registered passkey to finish signing in.
				</p>
			</div>

			{#if errorMessage}
				<AuthError>{errorMessage}</AuthError>
			{/if}

			<Button class="w-full" disabled={loading} onclick={handlePasskeySignIn}>
				{#if loading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<Fingerprint class="size-4" />
					Verify with passkey
				{/if}
			</Button>

			{#if data.canUseTotp}
				<p class="text-center text-xs">
					<a href={totpHref} class="text-red-400 hover:text-red-300"
						>Use authenticator app instead</a
					>
				</p>
			{/if}

			<p class="text-center text-xs text-muted-foreground">
				Need another method?
				<a href={loginHref} class="text-red-400 hover:text-red-300">Back to sign in</a>
			</p>
		</div>
	</div>
</div>
