<script lang="ts">
	import QRCode from 'qrcode';
	import { untrack } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import {
		confirmTotpResetChoice,
		sendTotpResetCode,
		verifyTotpResetCode
	} from '$lib/remote/two-factor.remote';
	import {
		TOTP_RESET_FLOW_STEP_COUNT,
		totpResetStepLabel,
		totpResetStepNumber,
		type TotpResetFlowStep,
		type TotpResetUiChoice
	} from '$lib/totp-reset-flow';
	import { getErrorMessage } from '$lib/utils';
	import Check from '~icons/lucide/check';
	import Minus from '~icons/lucide/minus';
	import Copy from '~icons/nucleo/copy';
	import ShieldCheck from '~icons/nucleo/shield-check';

	type Props = {
		open?: boolean;
		userEmail?: string | null;
		onComplete?: (choice: 'reset' | 'disable') => void;
	};

	let { open = $bindable(false), userEmail = null, onComplete }: Props = $props();

	let step = $state<TotpResetFlowStep>('email');
	let emailCode = $state('');
	let codeSending = $state(false);
	let codeRequested = $state(false);
	let codeSent = $state(false);
	let verifyingEmail = $state(false);
	let emailError = $state('');
	let choice = $state<TotpResetUiChoice>('reset-totp');
	let password = $state('');
	let confirming = $state(false);
	let confirmError = $state('');
	let totpUri = $state('');
	let secretKey = $state('');
	let backupCodes = $state<string[]>([]);
	let verifyCode = $state('');
	let verifyingSetup = $state(false);
	let setupError = $state('');
	let copiedSecret = $state(false);
	let copiedBackup = $state(false);
	let qrCodeSrc = $state('');

	let normalizedEmailCode = $derived(emailCode.replace(/\D/g, '').slice(0, 6));
	let normalizedVerifyCode = $derived(verifyCode.replace(/\D/g, ''));
	let stepNumber = $derived(totpResetStepNumber(step));
	let stepLabel = $derived(totpResetStepLabel(step));
	let emailTarget = $derived(userEmail?.trim() ? userEmail : 'your email address');
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
		}
	});

	const invalidSetupCodeMessage =
		'Invalid code. Use the newest scanned Fyra entry and make sure your device time is set automatically.';

	function getSetupErrorMessage(message?: string) {
		const normalizedMessage = message?.trim();

		return normalizedMessage === 'INVALID_CODE' ||
			normalizedMessage === 'Invalid code' ||
			normalizedMessage === 'Invalid code.'
			? invalidSetupCodeMessage
			: (message ?? invalidSetupCodeMessage);
	}

	function resetFlow() {
		step = 'email';
		emailCode = '';
		codeRequested = false;
		codeSent = false;
		emailError = '';
		choice = 'reset-totp';
		password = '';
		confirmError = '';
		totpUri = '';
		secretKey = '';
		backupCodes = [];
		verifyCode = '';
		setupError = '';
		copiedSecret = false;
		copiedBackup = false;
	}

	function backToChoice() {
		password = '';
		confirmError = '';
		step = 'choice';
	}

	async function sendCode() {
		if (codeSending) return;
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
		if (verifyingEmail || normalizedEmailCode.length !== 6) return;
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

	function continueFromChoice() {
		step = choice === 'reset-totp' ? 'reset' : 'disable';
	}

	async function confirmResetPassword() {
		if (!password || confirming) return;
		confirming = true;
		confirmError = '';
		try {
			await confirmTotpResetChoice({ password, choice: 'reset-totp' });
			const { data, error } = await authClient.twoFactor.enable({
				password,
				issuer: 'Fyra Stack'
			});
			if (error) {
				confirmError = error.message ?? 'Failed to start authenticator setup.';
				return;
			}
			if (data) {
				totpUri = data.totpURI ?? '';
				secretKey = new URL(data.totpURI ?? '').searchParams.get('secret') ?? '';
				backupCodes = data.backupCodes ?? [];
				verifyCode = '';
				setupError = '';
				step = 'setup';
			}
		} catch (err) {
			confirmError = getErrorMessage(err, 'Failed to reset two-factor authentication.');
		} finally {
			confirming = false;
		}
	}

	async function verifySetup() {
		if (!normalizedVerifyCode || verifyingSetup) return;
		verifyingSetup = true;
		setupError = '';
		const { error } = await authClient.twoFactor.verifyTotp({
			code: normalizedVerifyCode
		});
		verifyingSetup = false;
		if (error) {
			setupError = getSetupErrorMessage(error.message);
			return;
		}
		const done = onComplete;
		open = false;
		done?.('reset');
	}

	async function confirmDisable() {
		if (!password || confirming) return;
		confirming = true;
		confirmError = '';
		try {
			await confirmTotpResetChoice({ password, choice: 'disable-totp' });
			const done = onComplete;
			open = false;
			done?.('disable');
		} catch (err) {
			confirmError = getErrorMessage(err, 'Failed to disable two-factor authentication.');
		} finally {
			confirming = false;
		}
	}

	function copyText(text: string, key: 'secret' | 'backup') {
		navigator.clipboard.writeText(text);
		if (key === 'secret') {
			copiedSecret = true;
			setTimeout(() => (copiedSecret = false), 1500);
		} else {
			copiedBackup = true;
			setTimeout(() => (copiedBackup = false), 1500);
		}
	}

	$effect(() => {
		if (!open) {
			resetFlow();
		}
	});

	$effect(() => {
		if (open && step === 'email' && !codeRequested && !codeSending) {
			untrack(() => {
				void sendCode();
			});
		}
	});

	$effect(() => {
		const uri = totpUri;
		if (!uri) {
			qrCodeSrc = '';
			return;
		}

		let cancelled = false;
		void QRCode.toDataURL(uri, {
			width: 180,
			margin: 0,
			color: {
				dark: '#fafafa',
				light: '#27272a'
			},
			errorCorrectionLevel: 'M'
		}).then((src) => {
			if (!cancelled) qrCodeSrc = src;
		});

		return () => {
			cancelled = true;
		};
	});
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) resetFlow();
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Reset authenticator app</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		<p class="text-xs text-muted-foreground">
			Step {stepNumber} of {TOTP_RESET_FLOW_STEP_COUNT} · {stepLabel}
		</p>

		{#if step === 'email'}
			<form
				class="flex flex-col gap-4 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					void verifyEmail();
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
						<p class="text-xs text-muted-foreground">We sent a code to {emailTarget}.</p>
					{/if}
					{#if emailError}
						<p class="text-xs text-red-400">{emailError}</p>
					{/if}
				</div>

				<Dialog.Footer>
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
				</Dialog.Footer>
			</form>
		{:else if step === 'choice'}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2" role="radiogroup" aria-label="Two-factor action">
					<button
						type="button"
						role="radio"
						aria-checked={choice === 'reset-totp'}
						onclick={() => (choice = 'reset-totp')}
						class="flex items-start gap-3 border px-3 py-3 text-left transition-colors {choice ===
						'reset-totp'
							? 'border-primary bg-primary/10'
							: 'border-border hover:border-ring'}"
					>
						<ShieldCheck class="mt-0.5 size-4 shrink-0 text-red-400" />
						<span>
							<span class="block text-sm font-medium text-foreground">
								Set up a new authenticator
							</span>
							<span class="mt-0.5 block text-xs text-muted-foreground">
								Remove the old authenticator and scan a new code with your app.
							</span>
						</span>
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={choice === 'disable-totp'}
						onclick={() => (choice = 'disable-totp')}
						class="flex items-start gap-3 border px-3 py-3 text-left transition-colors {choice ===
						'disable-totp'
							? 'border-primary bg-primary/10'
							: 'border-border hover:border-ring'}"
					>
						<Minus class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span>
							<span class="block text-sm font-medium text-foreground">
								Turn off two-factor authentication
							</span>
							<span class="mt-0.5 block text-xs text-muted-foreground">
								Signing in will only require your email and password.
							</span>
						</span>
					</button>
				</div>

				<Dialog.Footer>
					<Button variant="outline" type="button" onclick={() => (open = false)}>Cancel</Button>
					<Button type="button" class="gap-1.5" onclick={continueFromChoice}>Continue</Button>
				</Dialog.Footer>
			</div>
		{:else if step === 'reset'}
			<form
				class="flex flex-col gap-4 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					void confirmResetPassword();
				}}
			>
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

				<Dialog.Footer>
					<Button variant="outline" type="button" onclick={backToChoice} disabled={confirming}>
						Back
					</Button>
					<Button type="submit" class="gap-1.5" disabled={confirming || !password}>
						<ShieldCheck class="size-4" />
						{confirming ? 'Confirming...' : 'Continue'}
					</Button>
				</Dialog.Footer>
			</form>
		{:else if step === 'setup' && totpUri}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex justify-center">
					<div class="rounded-xs border border-border bg-muted p-3">
						<img src={qrCodeSrc} alt="Authenticator app QR code" />
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label class="text-xs text-muted-foreground">Manual Entry Key</Label>
					<div class="flex items-center gap-2">
						<code
							class="flex-1 overflow-hidden rounded-xs border border-border bg-muted px-2 py-1.5 font-mono text-xs text-ellipsis whitespace-nowrap text-foreground"
						>
							{secretKey}
						</code>
						<button
							type="button"
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => copyText(secretKey, 'secret')}
						>
							{#if copiedSecret}
								<Check class="h-3.5 w-3.5 text-emerald-500" />
							{:else}
								<Copy class="size-4" />
							{/if}
						</button>
					</div>
				</div>

				{#if backupCodes.length > 0}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center justify-between">
							<Label class="text-xs text-muted-foreground">Backup Codes</Label>
							<button
								type="button"
								class="text-xs text-muted-foreground hover:text-foreground"
								onclick={() => copyText(backupCodes.join('\n'), 'backup')}
							>
								{#if copiedBackup}
									<Check class="h-3 w-3 text-emerald-500" />
								{:else}
									<Copy class="h-3 w-3" />
								{/if}
							</button>
						</div>
						<div class="grid grid-cols-2 gap-1 rounded-xs border border-border bg-muted p-2">
							{#each backupCodes as code (code)}
								<code class="font-mono text-xs text-muted-foreground">{code}</code>
							{/each}
						</div>
					</div>
				{/if}

				<div class="flex flex-col gap-1.5">
					<Label>Verification Code</Label>
					<Input
						bind:value={verifyCode}
						placeholder="000000"
						class="font-mono tracking-widest"
						autocomplete="one-time-code"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength={6}
						onkeydown={(e) => e.key === 'Enter' && verifySetup()}
					/>
					{#if setupError}
						<p class="text-xs text-red-400">{setupError}</p>
					{/if}
				</div>

				<Button
					onclick={verifySetup}
					disabled={verifyingSetup || !normalizedVerifyCode}
					class="gap-1.5"
				>
					<ShieldCheck class="size-4" />
					{verifyingSetup ? 'Verifying...' : 'Verify & Finish'}
				</Button>
			</div>
		{:else if step === 'disable'}
			<form
				class="flex flex-col gap-4 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					void confirmDisable();
				}}
			>
				<div class="rounded-xs border border-red-500/20 bg-red-500/5 p-3">
					<p class="text-sm text-muted-foreground">
						After disabling, signing in will only require your email and password.
					</p>
				</div>

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

				<Dialog.Footer>
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
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
