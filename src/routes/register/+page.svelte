<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authClient } from '$lib/auth-client';
	import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from '@lucide/svelte';
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import type { PageData } from './$types';
	import GoogleIcon from '$lib/components/google-icon.svelte';

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
	<title>Register / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-950 px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-gray-50">Stack</span>
		</div>

		<div class="space-y-5">
			<h1 class="text-center text-lg font-medium text-gray-50">Create account</h1>

			{#if error}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertCircle class="h-3.5 w-3.5 shrink-0" />
					{error}
				</div>
			{/if}

			{#if success}
				<div
					class="flex items-center gap-2 border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300"
				>
					<CheckCircle2 class="h-3.5 w-3.5 shrink-0 text-red-400" />
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
				<Input type="text" bind:value={name} placeholder="Name" required />
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
						class="absolute top-1/2 right-2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}<EyeOff class="h-3.5 w-3.5" />{:else}<Eye class="h-3.5 w-3.5" />{/if}
					</button>
				</div>

				<Input
					type={showPassword ? 'text' : 'password'}
					bind:value={confirmPassword}
					placeholder="Confirm password"
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
				<div class="h-px flex-1 bg-gray-800"></div>
				<span class="text-[10px] text-gray-500">or</span>
				<div class="h-px flex-1 bg-gray-800"></div>
			</div>

			<div class="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					class="flex-1 gap-1.5"
					onclick={() => authClient.signIn.social({ provider: 'github', callbackURL: redirectTo })}
				>
					<SiGithub class="h-3.5 w-3.5" color="currentColor" />
					GitHub
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="flex-1 gap-1.5"
					onclick={() => authClient.signIn.social({ provider: 'google', callbackURL: redirectTo })}
				>
					<GoogleIcon class="h-3.5 w-3.5" />
					Google
				</Button>
			</div>

			<p class="text-center text-xs text-gray-500">
				Already have an account? <a href={loginHref} class="text-red-400 hover:text-red-300"
					>Sign in</a
				>
			</p>
		</div>
	</div>
</div>
