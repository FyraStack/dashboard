<script lang="ts">
	import { authClient } from '#lib/auth-client.js';
	import { authHref } from '#lib/auth-redirect.js';
	import AuthError from '#lib/components/auth-error.svelte';
	import AuthLogo from '#lib/components/auth-logo.svelte';
	import GithubSignInButton from '#lib/components/github-sign-in-button.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Loader2 from '~icons/lucide/loader-2';
	import CheckCircle2 from '~icons/nucleo/check-circle';
	import Eye from '~icons/nucleo/eye';
	import EyeOff from '~icons/nucleo/eye-off';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const redirectTo = $derived(data.redirectTo ?? '/');
	const loginHref = $derived(authHref('/login', redirectTo));
	const verificationCallbackUrl = $derived(authHref('/login', redirectTo, { verified: '1' }));

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let errorMessage = $state('');
	let success = $state(false);
	let loading = $state(false);

	async function handleRegister() {
		if (!(name && email && password && confirmPassword)) {
			return;
		}
		errorMessage = '';
		success = false;

		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match';
			return;
		}

		loading = true;

		const res = await authClient.signUp.email({
			name,
			email,
			password,
			callbackURL: verificationCallbackUrl
		});

		loading = false;

		if (res.error) {
			errorMessage = res.error.message ?? 'Unable to create account';
			return;
		}

		success = true;
	}
</script>

<svelte:head>
	<title>Register / Stack</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<AuthLogo />

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-foreground">Create account</h1>

			{#if errorMessage}
				<AuthError>{errorMessage}</AuthError>
			{/if}

			{#if success}
				<div
					class="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
				>
					<CheckCircle2 class="size-4 shrink-0 text-red-400" />
					Check your email to verify your account.
				</div>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleRegister();
				}}
				class="space-y-3"
			>
				<Input
					type="text"
					bind:value={name}
					placeholder="Name"
					aria-label="Name"
					autocomplete="name"
					allowAutofill
					required
				/>
				<Input
					type="email"
					bind:value={email}
					placeholder="Email"
					aria-label="Email"
					autocomplete="username"
					required
				/>

				<div class="relative">
					<Input
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="Password"
						aria-label="Password"
						autocomplete="new-password"
						class="pr-10"
						required
					/>
					<button
						type="button"
						aria-label={showPassword ? 'Hide password' : 'Show password'}
						class="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}
							<EyeOff class="size-4" />
						{:else}
							<Eye class="size-4" />
						{/if}
					</button>
				</div>

				<Input
					type={showPassword ? 'text' : 'password'}
					bind:value={confirmPassword}
					placeholder="Confirm password"
					aria-label="Confirm password"
					autocomplete="new-password"
					required
				/>

				<Button type="submit" class="w-full" disabled={loading || success}>
					{#if loading}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						Create account
					{/if}
				</Button>
			</form>

			<div class="flex items-center gap-2">
				<div class="h-px flex-1 bg-muted"></div>
				<span class="text-[10px] text-muted-foreground">or</span>
				<div class="h-px flex-1 bg-muted"></div>
			</div>

			<GithubSignInButton {redirectTo} onError={(message) => (errorMessage = message)} />

			<p class="text-center text-xs text-muted-foreground">
				Already have an account?
				<a
					href={loginHref}
					class="text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
				>
					Sign in
				</a>
			</p>
		</div>
	</div>
</main>
