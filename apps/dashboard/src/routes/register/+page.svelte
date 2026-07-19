<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authClient } from '$lib/auth-client';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertCircle from '~icons/nucleo/alert-circle';
	import CheckCircle2 from '~icons/nucleo/check-circle';
	import Eye from '~icons/nucleo/eye';
	import EyeOff from '~icons/nucleo/eye-off';
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import type { PageData } from './$types';
	import { dashboardBrand, pageTitle } from '$lib/branding';

	let { data }: { data: PageData } = $props();
	const redirectTo = $derived(data.redirectTo ?? '/');
	const loginHref = $derived(
		redirectTo === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(redirectTo)}`
	);
	const verificationCallbackUrl = $derived(
		redirectTo === '/'
			? '/login?verified=1'
			: `/login?verified=1&redirectTo=${encodeURIComponent(redirectTo)}`
	);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let error = $state('');
	let success = $state(false);
	let loading = $state(false);
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

	async function handleRegister() {
		if (!name || !email || !password || !confirmPassword) return;
		error = '';
		success = false;

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
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
			error = res.error.message ?? 'Unable to create account';
			return;
		}

		success = true;
	}
</script>

<svelte:head>
	<title>{pageTitle('Register')}</title>
</svelte:head>

<main class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src={dashboardBrand.logo} alt={dashboardBrand.name} class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-foreground">
				{dashboardBrand.name}
			</span>
		</div>

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-foreground">Create account</h1>

			{#if error}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertCircle class="size-4 shrink-0" />
					{error}
				</div>
			{/if}

			{#if success}
				<div
					class="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
				>
					<CheckCircle2 class="size-4 shrink-0 text-primary" />
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
				<Input type="text" bind:value={name} placeholder="Name" aria-label="Name" required />
				<Input type="email" bind:value={email} placeholder="Email" aria-label="Email" required />

				<div class="relative">
					<Input
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="Password"
						aria-label="Password"
						class="pr-10"
						required
					/>
					<button
						type="button"
						aria-label={showPassword ? 'Hide password' : 'Show password'}
						class="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
					</button>
				</div>

				<Input
					type={showPassword ? 'text' : 'password'}
					bind:value={confirmPassword}
					placeholder="Confirm password"
					aria-label="Confirm password"
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
