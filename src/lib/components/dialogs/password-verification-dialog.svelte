<script lang="ts">
	import { untrack } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		confirmPasswordChangeWithEmail,
		confirmPasswordChangeWithPasskey,
		confirmPasswordChangeWithTotp,
		sendPasswordChangeCode
	} from '$lib/remote/password-change.remote';
	import { getErrorMessage } from '$lib/utils';
	import { Fingerprint } from '@lucide/svelte';

	type VerificationMethod = 'passkey' | 'totp' | 'email';

	type Props = {
		open?: boolean;
		hasPassword?: boolean;
		hasPasskey?: boolean;
		twoFactorEnabled: boolean;
		currentPassword: string;
		newPassword: string;
		onVerified?: () => void;
	};

	let {
		open = $bindable(false),
		hasPassword = true,
		hasPasskey = false,
		twoFactorEnabled,
		currentPassword,
		newPassword,
		onVerified
	}: Props = $props();

	let passwordVerificationCode = $state('');
	let passwordCodeSending = $state(false);
	let passwordCodeRequested = $state(false);
	let passwordCodeSent = $state(false);
	let passwordVerifying = $state(false);
	let passwordVerificationError = $state('');
	let verificationMethod: VerificationMethod = $derived(
		hasPasskey ? 'passkey' : twoFactorEnabled ? 'totp' : 'email'
	);
	let normalizedPasswordVerificationCode = $derived(passwordVerificationCode.replace(/\D/g, ''));
	let passwordVerificationDescription = $derived.by(() => {
		if (verificationMethod === 'passkey') {
			return 'Use a passkey registered to your account to finish changing your password.';
		}

		return verificationMethod === 'totp'
			? 'Enter a code from your authenticator app to finish changing your password.'
			: 'Enter the code we sent to your email address to finish changing your password.';
	});
	let passwordVerificationLabel = $derived(
		verificationMethod === 'totp' ? 'Authenticator Code' : 'Email Verification Code'
	);
	let passwordVerificationDisabled = $derived(
		passwordVerifying ||
			passwordCodeSending ||
			(verificationMethod !== 'passkey' && normalizedPasswordVerificationCode.length !== 6)
	);

	function resetPasswordVerification() {
		passwordVerificationCode = '';
		passwordVerificationError = '';
		passwordCodeRequested = false;
		passwordCodeSent = false;
	}

	function closePasswordVerification() {
		open = false;
		resetPasswordVerification();
	}

	async function verifyPasswordChange() {
		if (passwordVerificationDisabled) {
			return;
		}

		passwordVerifying = true;
		passwordVerificationError = '';

		try {
			if (verificationMethod === 'passkey') {
				const { error } = await authClient.signIn.passkey({ autoFill: false });

				if (error) {
					passwordVerificationError = error.message ?? 'Failed to verify passkey.';
					return;
				}

				await confirmPasswordChangeWithPasskey({ currentPassword, newPassword });
			} else if (verificationMethod === 'totp') {
				await confirmPasswordChangeWithTotp({
					currentPassword,
					newPassword,
					code: normalizedPasswordVerificationCode
				});
			} else {
				await confirmPasswordChangeWithEmail({
					currentPassword,
					newPassword,
					code: normalizedPasswordVerificationCode
				});
			}

			open = false;
			passwordVerificationCode = '';
			passwordCodeSent = false;
			onVerified?.();
		} catch (err) {
			passwordVerificationError = getErrorMessage(err, 'Failed to update password.');
		} finally {
			passwordVerifying = false;
		}
	}

	async function sendPasswordCode() {
		if (
			passwordCodeSending ||
			verificationMethod !== 'email' ||
			(hasPassword && !currentPassword) ||
			!newPassword
		) {
			return;
		}

		passwordCodeSending = true;
		passwordCodeRequested = true;
		passwordVerificationError = '';

		try {
			await sendPasswordChangeCode();
			passwordCodeSent = true;
		} catch (err) {
			passwordCodeSent = false;
			passwordVerificationError = getErrorMessage(err, 'Failed to send verification code.');
		} finally {
			passwordCodeSending = false;
		}
	}

	$effect(() => {
		if (!open) {
			resetPasswordVerification();
		}
	});

	$effect(() => {
		if (open && verificationMethod === 'email' && !passwordCodeRequested && !passwordCodeSending) {
			untrack(() => {
				void sendPasswordCode();
			});
		}
	});
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) resetPasswordVerification();
	}}
>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Verify password change</Dialog.Title>
			<Dialog.Description>{passwordVerificationDescription}</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-4"
			onsubmit={(e) => {
				e.preventDefault();
				void verifyPasswordChange();
			}}
		>
			{#if verificationMethod === 'passkey'}
				<div class="flex items-center gap-3 rounded-xs border border-gray-800 bg-gray-950/40 p-3">
					<Fingerprint class="size-5 shrink-0 text-gray-500" />
					<p class="text-sm text-gray-300">
						Your browser will ask you to authenticate with your registered passkey.
					</p>
				</div>
				{#if passwordVerificationError}
					<p class="text-xs text-red-400">{passwordVerificationError}</p>
				{/if}
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label>{passwordVerificationLabel}</Label>
					<Input
						bind:value={passwordVerificationCode}
						inputmode="numeric"
						placeholder="000000"
						maxlength={6}
						autocomplete="one-time-code"
					/>
					{#if verificationMethod === 'email' && passwordCodeSent}
						<p class="text-xs text-gray-500">We sent a code to your email address.</p>
					{/if}
					{#if passwordVerificationError}
						<p class="text-xs text-red-400">{passwordVerificationError}</p>
					{/if}
				</div>
			{/if}

			<Dialog.Footer>
				{#if verificationMethod === 'email'}
					<Button
						variant="outline"
						type="button"
						onclick={sendPasswordCode}
						disabled={passwordCodeSending || passwordVerifying}
					>
						{passwordCodeSending ? 'Sending...' : 'Resend Code'}
					</Button>
				{/if}
				<Button
					variant="outline"
					type="button"
					onclick={closePasswordVerification}
					disabled={passwordVerifying}
				>
					Cancel
				</Button>
				<Button type="submit" class="gap-1.5" disabled={passwordVerificationDisabled}>
					{passwordVerifying
						? 'Verifying...'
						: verificationMethod === 'passkey'
							? 'Verify with passkey'
							: 'Verify'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
