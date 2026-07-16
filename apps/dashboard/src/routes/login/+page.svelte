<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authClient } from '$lib/auth-client';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertCircle from '~icons/nucleo/alert-circle';
	import CheckCircle2 from '~icons/nucleo/check-circle';
	import Eye from '~icons/nucleo/eye';
	import EyeOff from '~icons/nucleo/eye-off';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import type { PageData } from './$types';
	type SignInDataWithTwoFactor = {
		twoFactorRedirect?: boolean;
		twoFactorMethods?: string[] | null;
	};

	let { data }: { data: PageData } = $props();
	const redirectTo = $derived(data.redirectTo ?? '/');
	const verified = $derived(data.verified ?? false);
	const registerHref = $derived(
		redirectTo === '/' ? '/register' : `/register?redirectTo=${encodeURIComponent(redirectTo)}`
	);

	let email = $state('');
	let password = $state('');
	let showPassword = $state(false);
	let error = $state('');
	let loading = $state(false);
	let passkeyLoading = $state(false);
	let socialLoading = $state<'github' | null>(null);

	async function signInWithSocial(provider: 'github') {
		if (socialLoading) return;
		error = '';
		socialLoading = provider;
		try {
			const { error: err } = await authClient.signIn.social({ provider, callbackURL: redirectTo });
			if (err) {
				error = err.message ?? 'Unable to sign in.';
				socialLoading = null;
			}
		} catch {
			error = 'Unable to sign in.';
			socialLoading = null;
		}
	}

	function twoFactorHref(method: 'passkey' | 'totp') {
		const path = `/login/two-factor/${method}`;
		return redirectTo === '/' ? path : `${path}?redirectTo=${encodeURIComponent(redirectTo)}`;
	}

	async function handleLogin() {
		if (!email || !password) return;
		error = '';
		loading = true;

		const res = await authClient.signIn.email({ email, password });

		if (res.error) {
			error = res.error.message ?? 'Invalid credentials';
			loading = false;
			return;
		}

		const loginData = res.data as SignInDataWithTwoFactor | null | undefined;

		if (loginData?.twoFactorRedirect) {
			const methods = loginData.twoFactorMethods;
			const missingMethodsMeansTotp = !methods || methods.includes('totp');

			if (missingMethodsMeansTotp) {
				goto(twoFactorHref('totp'));
				return;
			}

			if (methods.includes('passkey')) {
				goto(twoFactorHref('passkey'));
				return;
			}
		}

		goto(redirectTo);
	}

	async function handlePasskeySignIn() {
		error = '';
		passkeyLoading = true;

		const { error: err } = await authClient.signIn.passkey({ autoFill: false });

		passkeyLoading = false;

		if (err) {
			error = err.message ?? 'Unable to sign in with passkey.';
			return;
		}

		goto(redirectTo);
	}
</script>

<svelte:head>
	<title>Sign in / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-foreground">Stack</span>
		</div>

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-foreground">Sign in</h1>

			{#if error}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertCircle class="h-3.5 w-3.5 shrink-0" />
					{error}
				</div>
			{/if}

			{#if verified}
				<div
					class="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
				>
					<CheckCircle2 class="h-3.5 w-3.5 shrink-0 text-red-400" />
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
				<Input type="email" bind:value={email} placeholder="Email" required />

				<div class="relative">
					<Input
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="Password"
						required
					/>
					<button
						type="button"
						class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}<EyeOff class="h-3.5 w-3.5" />{:else}<Eye class="h-3.5 w-3.5" />{/if}
					</button>
				</div>

				<Button type="submit" class="w-full" disabled={loading}>
					{#if loading}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						Sign in
					{/if}
				</Button>
			</form>

			<div class="flex items-center gap-2">
				<div class="h-px flex-1 bg-muted"></div>
				<span class="text-[10px] text-muted-foreground">or</span>
				<div class="h-px flex-1 bg-muted"></div>
			</div>

			<Button
				variant="outline"
				size="sm"
				class="w-full gap-1.5"
				loading={socialLoading === 'github'}
				disabled={socialLoading !== null}
				onclick={() => signInWithSocial('github')}
			>
				{#if socialLoading !== 'github'}
					<SiGithub class="h-3.5 w-3.5" color="currentColor" />
				{/if}
				GitHub
			</Button>

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
					<Fingerprint class="h-3.5 w-3.5" />
					Sign in with passkey
				{/if}
			</Button>

			<p class="text-center text-xs text-muted-foreground">
				No account? <a href={registerHref} class="text-red-400 hover:text-red-300">Create one</a>
			</p>
		</div>
	</div>
</div>
