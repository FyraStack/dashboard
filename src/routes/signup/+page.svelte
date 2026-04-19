<script lang="ts">
	import '../layout.css';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { authClient } from '$lib/auth-client';
	import { UserPlus, Eye, EyeOff, AlertCircle, Loader2 } from '@lucide/svelte';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirm = $state('');
	let showPassword = $state(false);
	let error = $state('');
	let loading = $state(false);

	async function handleSignup() {
		if (!name || !email || !password) return;
		if (password !== confirm) {
			error = 'Passwords do not match';
			return;
		}
		error = '';
		loading = true;

		const res = await authClient.signUp.email({ name, email, password });

		if (res.error) {
			error = res.error.message ?? 'Signup failed';
			loading = false;
			return;
		}

		goto('/');
	}

	async function handleGithub() {
		await authClient.signIn.social({ provider: 'github', callbackURL: '/' });
	}

	async function handleGoogle() {
		await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-fyra-gray-950 px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-fyra-gray-50">Stack</span>
		</div>

		<div class="space-y-4">
			<h1 class="text-center text-lg font-medium text-fyra-gray-50">Create account</h1>

			{#if error}
				<div
					class="flex items-center gap-2 border border-fyra-red-700 bg-fyra-red-950 px-3 py-2 text-sm text-fyra-red-400"
				>
					<AlertCircle class="h-3.5 w-3.5 shrink-0" />
					{error}
				</div>
			{/if}

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSignup();
				}}
				class="space-y-3"
			>
				<Input type="text" bind:value={name} placeholder="Full name" required />
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
						class="absolute top-1/2 right-2 -translate-y-1/2 text-fyra-gray-500 hover:text-fyra-gray-300"
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}<EyeOff class="h-3.5 w-3.5" />{:else}<Eye class="h-3.5 w-3.5" />{/if}
					</button>
				</div>

				<Input type="password" bind:value={confirm} placeholder="Confirm password" required />
				{#if confirm && password !== confirm}
					<p class="text-xs text-fyra-red-400">Passwords do not match.</p>
				{/if}

				<Button
					type="submit"
					class="w-full"
					disabled={loading || (!!confirm && password !== confirm)}
				>
					{#if loading}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						Create account
					{/if}
				</Button>
			</form>

			<div class="flex items-center gap-2">
				<div class="h-px flex-1 bg-fyra-gray-800"></div>
				<span class="text-[10px] text-fyra-gray-600">or</span>
				<div class="h-px flex-1 bg-fyra-gray-800"></div>
			</div>

			<div class="flex gap-2">
				<Button variant="outline" size="sm" class="flex-1 gap-1.5" onclick={handleGithub}>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"
						><path
							d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.694.825.577C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z"
						/></svg
					>
					GitHub
				</Button>
				<Button variant="outline" size="sm" class="flex-1 gap-1.5" onclick={handleGoogle}>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"
						><path
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
						/><path
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
						/><path
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
						/><path
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
						/></svg
					>
					Google
				</Button>
			</div>

			<p class="text-center text-xs text-fyra-gray-500">
				Already have an account? <a href="/login" class="text-fyra-red-400 hover:text-fyra-red-300"
					>Sign in</a
				>
			</p>
		</div>
	</div>
</div>
