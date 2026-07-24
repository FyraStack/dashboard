<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authClient } from '$lib/auth-client';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertCircle from '~icons/nucleo/alert-circle';
	import CheckCircle2 from '~icons/nucleo/check-circle';

	let email = $state('');
	let error = $state('');
	let loading = $state(false);
	let sent = $state(false);

	async function handleSubmit() {
		if (!email) return;
		error = '';
		loading = true;

		const { error: err } = await authClient.requestPasswordReset({
			email,
			redirectTo: '/reset-password'
		});

		loading = false;

		if (err) {
			error = err.message ?? 'Unable to send reset email.';
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
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-foreground">Stack</span>
		</div>

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

				{#if error}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertCircle class="size-4 shrink-0" />
						{error}
					</div>
				{/if}

				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-3"
				>
					<Input type="email" bind:value={email} placeholder="Email" aria-label="Email" required />

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
