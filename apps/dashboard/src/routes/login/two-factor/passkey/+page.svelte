<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertCircle from '~icons/nucleo/alert-circle';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const redirectTo: string = $derived(data.redirectTo ?? '/');
	const loginHref = $derived(
		redirectTo === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(redirectTo)}`
	);
	const totpHref = $derived(
		redirectTo === '/'
			? '/login/two-factor/totp'
			: `/login/two-factor/totp?redirectTo=${encodeURIComponent(redirectTo)}`
	);

	let error = $state('');
	let loading = $state(false);

	onMount(() => {
		void handlePasskeySignIn();
	});

	async function handlePasskeySignIn() {
		error = '';
		loading = true;

		const { error: err } = await authClient.signIn.passkey({ autoFill: false });

		loading = false;

		if (err) {
			error = err.message ?? 'Unable to sign in with passkey.';
			return;
		}

		goto(redirectTo);
	}
</script>

<svelte:head>
	<title>Verify with Passkey / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-foreground">Stack</span>
		</div>

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

			{#if error}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertCircle class="h-3.5 w-3.5 shrink-0" />
					{error}
				</div>
			{/if}

			<Button class="w-full" disabled={loading} onclick={handlePasskeySignIn}>
				{#if loading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<Fingerprint class="h-3.5 w-3.5" />
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
				Need another method? <a href={loginHref} class="text-red-400 hover:text-red-300"
					>Back to sign in</a
				>
			</p>
		</div>
	</div>
</div>
