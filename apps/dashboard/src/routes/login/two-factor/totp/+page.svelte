<script lang="ts">
	import type { TotpResetChoice } from 'stack-shared/auth';
	import { untrack } from 'svelte';
	import { authClient } from '#lib/auth-client.js';
	import { authHref, goAfterAuth } from '#lib/auth-redirect.js';
	import AuthError from '#lib/components/auth-error.svelte';
	import AuthLogo from '#lib/components/auth-logo.svelte';
	import TotpSetup from '#lib/components/totp-setup.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import {
		confirmTotpResetChoice,
		sendTotpResetCode,
		verifyTotpResetCode
	} from '#lib/remote/two-factor.remote.js';
	import { getErrorMessage } from '#lib/utils.js';
	import { goto } from '$app/navigation';
	import Loader2 from '~icons/lucide/loader-2';
	import Minus from '~icons/lucide/minus';
	import ShieldCheck from '~icons/nucleo/shield-check';
	import type { PageData } from './$types';

	type TotpResetFlowStep = 'email' | 'choice' | 'reset' | 'setup' | 'disable';

	const totpResetStepCount = 3;
	const totpResetSteps: Record<TotpResetFlowStep, { label: string; number: number }> = {
		email: { number: 1, label: 'Verify your email' },
		choice: { number: 2, label: 'Choose what to do' },
		reset: { number: 3, label: 'Confirm your password' },
		setup: { number: 3, label: 'Set up your authenticator' },
		disable: { number: 3, label: 'Disable two-factor authentication' }
	};

	const footerClass = 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';

	let { data }: { data: PageData } = $props();
	const redirectTo: string = $derived(data.redirectTo ?? '/');
	const passkeyHref = $derived(authHref('/login/two-factor/passkey', redirectTo));

	let code = $state('');
	let errorMessage = $state('');
	let loading = $state(false);
	let normalizedCode = $derived(code.replace(/\D/g, ''));

	async function handleVerify() {
		if (!normalizedCode) {
			return;
		}
		errorMessage = '';
		loading = true;

		const { error: err } = await authClient.twoFactor.verifyTotp({
			code: normalizedCode
		});

		loading = false;

		if (err) {
			errorMessage = err.message ?? 'Invalid code. Please try again.';
			return;
		}

		await goAfterAuth(redirectTo);
	}

	let step = $state<TotpResetFlowStep>('email');
	let stepInfo = $derived(totpResetSteps[step]);
	let description = $derived.by(() => {
		switch (step) {
			case 'email':
				return `Enter the verification code we sent to ${emailTarget}.`;
			case 'choice':
				return 'Set up a new authenticator app, or turn two-factor authentication off.';
			case 'reset':
				return 'Confirm your password to remove the old authenticator and set up a new one.';
			case 'setup':
				return 'Scan the code with your authenticator app, then enter a code to finish.';
			case 'disable':
				return 'Confirm your password to turn off two-factor authentication.';
			default: {
				const unhandledStep: never = step;
				return unhandledStep;
			}
		}
	});

	let emailCode = $state('');
	let codeSending = $state(false);
	let codeRequested = $state(false);
	let codeSent = $state(false);
	let verifyingEmail = $state(false);
	let emailError = $state('');
	let normalizedEmailCode = $derived(emailCode.replace(/\D/g, '').slice(0, 6));
	let emailTarget = $derived(data.resetEmail?.trim() ? data.resetEmail : 'your email address');

	async function sendCode() {
		if (codeSending) {
			return;
		}
		codeSending = true;
		codeRequested = true;
		emailError = '';
		try {
			await sendTotpResetCode();
			codeSent = true;
		} catch (err) {
			codeSent = false;
			emailError = getErrorMessage(err, 'Failed to send verification code.');
		} finally {
			codeSending = false;
		}
	}

	async function verifyEmail() {
		if (verifyingEmail || normalizedEmailCode.length !== 6) {
			return;
		}
		verifyingEmail = true;
		emailError = '';
		try {
			await verifyTotpResetCode({ code: normalizedEmailCode });
			step = 'choice';
		} catch (err) {
			emailError = getErrorMessage(err, 'Failed to verify code.');
		} finally {
			verifyingEmail = false;
		}
	}

	$effect(() => {
		if (data.resetRequired && step === 'email' && !codeRequested && !codeSending) {
			untrack(() => {
				sendCode();
			});
		}
	});

	let choice = $state<TotpResetChoice>('reset');
	const choiceOptions = [
		{
			value: 'reset',
			icon: ShieldCheck,
			iconClass: 'text-red-400',
			title: 'Set up a new authenticator',
			description: 'Remove the old authenticator and scan a new code with your app.'
		},
		{
			value: 'disable',
			icon: Minus,
			iconClass: 'text-muted-foreground',
			title: 'Turn off two-factor authentication',
			description: 'Signing in will only require your email and password.'
		}
	] as const satisfies readonly {
		value: TotpResetChoice;
		icon: typeof ShieldCheck;
		iconClass: string;
		title: string;
		description: string;
	}[];

	let password = $state('');
	let confirming = $state(false);
	let confirmError = $state('');
	let totpUri = $state('');
	let backupCodes = $state<string[]>([]);

	const confirmations = {
		reset: {
			failureMessage: 'Failed to reset two-factor authentication.',
			onSession: enableNewAuthenticator
		},
		disable: {
			failureMessage: 'Failed to disable two-factor authentication.',
			onSession: () => goAfterAuth(redirectTo)
		}
	} satisfies Record<TotpResetChoice, { failureMessage: string; onSession: () => Promise<void> }>;

	function backToChoice() {
		password = '';
		confirmError = '';
		step = 'choice';
	}

	async function signInAfterReset(email: string): Promise<'session' | 'passkey' | null> {
		const { data: signInResult, error } = await authClient.signIn.email({ email, password });
		if (error) {
			confirmError = error.message ?? 'Two-factor authentication was reset, but signing in failed.';
			return null;
		}
		const signInData = signInResult as { twoFactorRedirect?: boolean } | null;
		return signInData?.twoFactorRedirect ? 'passkey' : 'session';
	}

	async function enableNewAuthenticator() {
		const { data: setup, error } = await authClient.twoFactor.enable({
			password,
			issuer: 'Fyra Stack'
		});
		if (error || setup?.method !== 'totp') {
			confirmError = error?.message ?? 'Failed to start authenticator setup.';
			return;
		}
		totpUri = setup.totpURI;
		({ backupCodes } = setup);
		step = 'setup';
	}

	async function confirmPassword(resetChoice: TotpResetChoice) {
		if (!password || confirming) {
			return;
		}
		const { failureMessage, onSession } = confirmations[resetChoice];
		confirming = true;
		confirmError = '';
		try {
			const result = await confirmTotpResetChoice({ password, choice: resetChoice });
			const outcome = await signInAfterReset(result.signInEmail);
			if (outcome === 'passkey') {
				await goto(passkeyHref);
			} else if (outcome === 'session') {
				await onSession();
			}
		} catch (err) {
			confirmError = getErrorMessage(err, failureMessage);
		} finally {
			confirming = false;
		}
	}
</script>

<svelte:head>
	<title>Two-Factor Authentication / Stack</title>
</svelte:head>

{#snippet heading(
	title: string,
	text: string
)}
	<div class="flex flex-col items-center gap-3">
		<div class="flex h-12 w-12 items-center justify-center border border-border bg-background">
			<ShieldCheck class="h-5 w-5 text-red-400" />
		</div>
		<h1 class="text-lg font-medium text-foreground">{title}</h1>
		<p class="text-center text-sm text-muted-foreground">{text}</p>
	</div>
{/snippet}

{#snippet passwordField()}
	<div class="flex flex-col gap-1.5">
		<Label>Current Password</Label>
		<Input
			bind:value={password}
			type="password"
			placeholder="********"
			autocomplete="current-password"
		/>
		{#if confirmError}
			<p class="text-xs text-red-400">{confirmError}</p>
		{/if}
	</div>
{/snippet}

{#snippet emailStep()}
	<form
		class="flex flex-col gap-4 py-4"
		onsubmit={(e) => {
			e.preventDefault();
			verifyEmail();
		}}
	>
		<div class="flex flex-col gap-1.5">
			<Label>Email Verification Code</Label>
			<Input
				bind:value={emailCode}
				placeholder="000000"
				class="font-mono tracking-widest"
				autocomplete="one-time-code"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength={6}
			/>
			{#if codeSent}
				<p class="text-center text-xs text-muted-foreground">We sent a code to {emailTarget}.</p>
			{/if}
			{#if emailError}
				<p class="text-xs text-red-400">{emailError}</p>
			{/if}
		</div>

		<div class={footerClass}>
			<Button
				variant="outline"
				type="button"
				onclick={sendCode}
				disabled={codeSending || verifyingEmail}
			>
				{codeSending ? 'Sending...' : 'Resend Code'}
			</Button>
			<Button
				type="submit"
				class="gap-1.5"
				disabled={verifyingEmail || codeSending || normalizedEmailCode.length !== 6}
			>
				{verifyingEmail ? 'Verifying...' : 'Verify'}
			</Button>
		</div>
	</form>
{/snippet}

{#snippet choiceStep()}
	<div class="flex flex-col gap-4 py-4">
		<div class="flex flex-col gap-2" role="radiogroup" aria-label="Two-factor action">
			{#each choiceOptions as option (option.value)}
				{@const Icon = option.icon}
				<label
					class="flex cursor-pointer items-start gap-3 border px-3 py-3 text-left transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring {choice ===
					option.value
						? 'border-primary bg-primary/10'
						: 'border-border hover:border-ring'}"
				>
					<input
						type="radio"
						name="two-factor-action"
						value={option.value}
						bind:group={choice}
						class="sr-only"
					/>
					<Icon class="mt-0.5 size-4 shrink-0 {option.iconClass}" />
					<span>
						<span class="block text-sm font-medium text-foreground">{option.title}</span>
						<span class="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
					</span>
				</label>
			{/each}
		</div>

		<div class={footerClass}>
			<Button type="button" class="gap-1.5" onclick={() => (step = choice)}>Continue</Button>
		</div>
	</div>
{/snippet}

{#snippet resetStep()}
	<form
		class="flex flex-col gap-4 py-4"
		onsubmit={(e) => {
			e.preventDefault();
			confirmPassword('reset');
		}}
	>
		{@render passwordField()}

		<div class={footerClass}>
			<Button variant="outline" type="button" onclick={backToChoice} disabled={confirming}>
				Back
			</Button>
			<Button type="submit" class="gap-1.5" disabled={confirming || !password}>
				<ShieldCheck class="size-4" />
				{confirming ? 'Confirming...' : 'Continue'}
			</Button>
		</div>
	</form>
{/snippet}

{#snippet setupStep()}
	<TotpSetup
		{totpUri}
		{backupCodes}
		submitLabel="Verify & Finish"
		onComplete={() => goAfterAuth(redirectTo)}
	/>
{/snippet}

{#snippet disableStep()}
	<form
		class="flex flex-col gap-4 py-4"
		onsubmit={(e) => {
			e.preventDefault();
			confirmPassword('disable');
		}}
	>
		<div class="rounded-xs border border-red-500/20 bg-red-500/5 p-3">
			<p class="text-sm text-muted-foreground">
				After disabling, signing in will only require your email and password.
			</p>
		</div>

		{@render passwordField()}

		<div class={footerClass}>
			<Button variant="outline" type="button" onclick={backToChoice} disabled={confirming}>
				Back
			</Button>
			<Button
				variant="destructive"
				type="submit"
				class="gap-1.5"
				disabled={confirming || !password}
			>
				{#if !confirming}
					<Minus class="h-3 w-3" />
				{/if}
				{confirming ? 'Disabling...' : 'Disable'}
			</Button>
		</div>
	</form>
{/snippet}

{#snippet resetFlow()}
	<div class="space-y-5">
		{@render heading(
			'Set up your authenticator again',
			"Due to a migration, you'll need to re-enroll your TOTP code. This is a one-time event, and your existing authenticator will no longer work."
		)}

		<div class="flex flex-col gap-3">
			<p class="text-center text-sm text-muted-foreground">{description}</p>
			<p class="text-center text-xs text-muted-foreground">
				Step {stepInfo.number} of {totpResetStepCount} · {stepInfo.label}
			</p>

			{#if step === 'email'}
				{@render emailStep()}
			{:else if step === 'choice'}
				{@render choiceStep()}
			{:else if step === 'reset'}
				{@render resetStep()}
			{:else if step === 'setup' && totpUri}
				{@render setupStep()}
			{:else if step === 'disable'}
				{@render disableStep()}
			{/if}
		</div>
	</div>
{/snippet}

{#snippet codeEntry()}
	<div class="space-y-5">
		{@render heading(
			'Two-Factor Authentication',
			'Enter the verification code from your authenticator app.'
		)}

		{#if errorMessage}
			<AuthError>{errorMessage}</AuthError>
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
				class="text-center font-mono tracking-widest"
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

		<p class="text-center text-xs text-muted-foreground">
			Lost your device? Use a backup code from when you set up 2FA.
		</p>
	</div>
{/snippet}

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<AuthLogo />

		{#if data.resetRequired}
			{@render resetFlow()}
		{:else}
			{@render codeEntry()}
		{/if}
	</div>
</div>
