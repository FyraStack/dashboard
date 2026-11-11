<script lang="ts">
	import { authClient } from '#lib/auth-client.js';
	import { authHref, goAfterAuth } from '#lib/auth-redirect.js';
	import AuthError from '#lib/components/auth-error.svelte';
	import AuthLogo from '#lib/components/auth-logo.svelte';
	import GithubSignInButton from '#lib/components/github-sign-in-button.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { goto } from '$app/navigation';
	import Loader2 from '~icons/lucide/loader-2';
	import CheckCircle2 from '~icons/nucleo/check-circle';
	import Eye from '~icons/nucleo/eye';
	import EyeOff from '~icons/nucleo/eye-off';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import type { PageData } from './$types';

	interface SignInDataWithTwoFactor {
		twoFactorMethods?: string[] | null;
		twoFactorRedirect?: boolean;
	}

	let { data }: { data: PageData } = $props();
	const redirectTo = $derived(data.redirectTo ?? '/');
	const verified = $derived(data.verified ?? false);
	const registerHref = $derived(authHref('/register', redirectTo));

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let errorMessage = $state('');
	let loading = $state(false);
	let passkeyLoading = $state(false);

	async function handleLogin() {
		if (!(email && password)) {
			return;
		}
		errorMessage = '';
		loading = true;

		const res = await authClient.signIn.email({ email, password });

		if (res.error) {
			errorMessage = res.error.message ?? 'Invalid credentials';
			loading = false;
			return;
		}

		const loginData = res.data as SignInDataWithTwoFactor | null | undefined;

		if (loginData?.twoFactorRedirect) {
			const methods = loginData.twoFactorMethods;

			if (methods?.includes('passkey')) {
				goto(authHref('/login/two-factor/passkey', redirectTo));
				return;
			}

			if (!methods || methods.includes('totp')) {
				goto(authHref('/login/two-factor/totp', redirectTo));
				return;
			}
		}

		await goAfterAuth(redirectTo);
	}

	async function handlePasskeySignIn() {
		errorMessage = '';
		passkeyLoading = true;

		const { error: err } = await authClient.signIn.passkey({ autoFill: false });

		passkeyLoading = false;

		if (err) {
			errorMessage = err.message ?? 'Unable to sign in with passkey.';
			return;
		}

		await goAfterAuth(redirectTo);
	}
</script>

<svelte:head>
	<title>Sign in / Stack</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<AuthLogo />

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-foreground">Sign in</h1>

			{#if errorMessage}
				<AuthError>{errorMessage}</AuthError>
			{/if}

			{#if verified}
				<div
					class="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
				>
					<CheckCircle2 class="size-4 shrink-0 text-red-400" />
					Email verified! Please sign in.
				</div>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleLogin();
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

				<div class="relative">
					<Input
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="Password"
						aria-label="Password"
						autocomplete="current-password"
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

				<Button type="submit" class="w-full" disabled={loading}>
					{#if loading}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						Sign in
					{/if}
				</Button>

				<div class="flex justify-center">
					<a
						href="/forgot-password"
						class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>
						Forgot password?
					</a>
				</div>
			</form>

			<div class="flex items-center gap-2">
				<div class="h-px flex-1 bg-muted"></div>
				<span class="text-[10px] text-muted-foreground">or</span>
				<div class="h-px flex-1 bg-muted"></div>
			</div>

			<GithubSignInButton {redirectTo} onError={(message) => (errorMessage = message)} />

			<Button
				variant="outline"
				size="sm"
				class="w-full gap-1.5"
				disabled={passkeyLoading}
				onclick={handlePasskeySignIn}
			>
				{#if passkeyLoading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<Fingerprint class="size-4" />
					Sign in with passkey
				{/if}
			</Button>

			<p class="text-center text-xs text-muted-foreground">
				No account?
				<a
					href={registerHref}
					class="text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
				>
					Create one
				</a>
			</p>
		</div>
	</div>
</main>
