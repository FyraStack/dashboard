<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ShieldCheck, Loader2, AlertCircle } from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const redirectTo: string = $derived(data.redirectTo ?? '/');

	let code = $state('');
	let error = $state('');
	let loading = $state(false);
	const normalizeTotpCode = (value: string) => value.replace(/\D/g, '');
	let normalizedCode = $derived(normalizeTotpCode(code));

	async function handleVerify() {
		if (!normalizedCode) return;
		error = '';
		loading = true;

		const { error: err } = await authClient.twoFactor.verifyTotp({
			code: normalizedCode
		});

		loading = false;

		if (err) {
			error = err.message ?? 'Invalid code. Please try again.';
			return;
		}

		goto(redirectTo);
	}
</script>

<svelte:head>
	<title>Two-Factor Authentication / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-gray-950 px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-gray-50">Stack</span>
		</div>

		<div class="space-y-5">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-12 w-12 items-center justify-center border border-gray-800 bg-gray-900">
					<ShieldCheck class="h-5 w-5 text-red-400" />
				</div>
				<h1 class="text-lg font-medium text-gray-50">Two-Factor Authentication</h1>
				<p class="text-center text-sm text-gray-400">
					Enter the verification code from your authenticator app.
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

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleVerify();
				}}
				class="space-y-3"
			>
				<Input
					bind:value={code}
					placeholder="000000"
					class="font-mono tracking-widest text-center"
					autocomplete="one-time-code"
					inputmode="numeric"
					pattern="[0-9]*"
					maxlength={6}
				/>

				<Button type="submit" class="w-full" disabled={loading || !normalizedCode}>
					{#if loading}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						Verify
					{/if}
				</Button>
			</form>

			<p class="text-center text-xs text-gray-500">
				Lost your device? Use a backup code from when you set up 2FA.
			</p>
		</div>
	</div>
</div>
