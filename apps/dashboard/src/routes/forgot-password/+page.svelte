<script lang="ts">
	import { resetPasswordPath } from 'stack-shared/routes';
	import { authClient } from '#lib/auth-client.js';
	import AuthError from '#lib/components/auth-error.svelte';
	import AuthLogo from '#lib/components/auth-logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Loader2 from '~icons/lucide/loader-2';
	import CheckCircle2 from '~icons/nucleo/check-circle';

	let email = $state('');
	let errorMessage = $state('');
	let loading = $state(false);
	let sent = $state(false);

	async function handleSubmit() {
		if (!email) {
			return;
		}
		errorMessage = '';
		loading = true;

		const { error: err } = await authClient.requestPasswordReset({
			email,
			redirectTo: resetPasswordPath
		});

		loading = false;

		if (err) {
			errorMessage = err.message ?? 'Unable to send reset email.';
			return;
		}

		sent = true;
	}
</script>

<svelte:head>
	<title>Forgot password / Stack</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<AuthLogo />

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-foreground">Reset your password</h1>

			{#if sent}
				<div
					class="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
				>
					<CheckCircle2 class="size-4 shrink-0 text-red-400" />
					If an account exists for {email}, we've sent it a reset link.
				</div>
			{:else}
				<p class="text-center text-xs text-muted-foreground">
					Enter your email and we'll send you a link to reset your password.
				</p>

				{#if errorMessage}
					<AuthError>{errorMessage}</AuthError>
				{/if}

				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-3"
				>
					<Input
						type="email"
						bind:value={email}
						placeholder="Email"
						aria-label="Email"
						autocomplete="username"
						required
					/>

					<Button type="submit" class="w-full" disabled={loading}>
						{#if loading}
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
						{:else}
							Send reset link
						{/if}
					</Button>
				</form>
			{/if}

			<p class="text-center text-xs text-muted-foreground">
				Remembered it?
				<a
					href="/login"
					class="text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
				>
					Back to sign in
				</a>
			</p>
		</div>
	</div>
</main>
