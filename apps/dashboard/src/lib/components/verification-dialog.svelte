<script lang="ts">
	import type { VerificationMethod } from 'stack-shared/auth';
	import { type Snippet, untrack } from 'svelte';
	import { authClient } from '#lib/auth-client.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { getErrorMessage } from '#lib/utils.js';
	import Loader2 from '~icons/lucide/loader-2';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import Trash2 from '~icons/nucleo/trash';

	interface Props {
		children?: Snippet;
		confirm: (code: string) => Promise<void>;
		description: string;
		destructive?: boolean;
		emailHint?: string;
		failureMessage: string;
		method: VerificationMethod;
		open?: boolean;
		passkeySubmitLabel?: string;
		sendCode?: () => Promise<void>;
		submitLabel: string;
		submittingLabel: string;
		title: string;
	}

	let {
		open = $bindable(false),
		method,
		title,
		description,
		emailHint,
		destructive = false,
		submitLabel,
		passkeySubmitLabel = submitLabel,
		submittingLabel,
		failureMessage,
		confirm,
		sendCode,
		children
	}: Props = $props();

	let code = $state('');
	let errorMessage = $state('');
	let verifying = $state(false);
	let sending = $state(false);
	let codeSent = $state(false);
	let sendRequested = false;

	const digits = $derived(code.replace(/\D/g, ''));
	const submitDisabled = $derived(
		verifying || sending || (method !== 'passkey' && digits.length !== 6)
	);
	const showEmailHint = $derived(method === 'email' && emailHint && (!sendCode || codeSent));

	async function send() {
		if (!sendCode || sending) {
			return;
		}
		sending = true;
		errorMessage = '';
		try {
			await sendCode();
			codeSent = true;
		} catch (err) {
			codeSent = false;
			errorMessage = getErrorMessage(err, 'Failed to send verification code.');
		} finally {
			sending = false;
		}
	}

	async function submit() {
		if (submitDisabled) {
			return;
		}
		verifying = true;
		errorMessage = '';
		try {
			if (method === 'passkey') {
				const { error: passkeyError } = await authClient.signIn.passkey({ autoFill: false });
				if (passkeyError) {
					errorMessage = passkeyError.message ?? 'Failed to verify passkey.';
					return;
				}
			}
			await confirm(method === 'passkey' ? '' : digits);
			open = false;
		} catch (err) {
			errorMessage = getErrorMessage(err, failureMessage);
		} finally {
			verifying = false;
		}
	}

	$effect(() => {
		if (!open) {
			code = '';
			errorMessage = '';
			codeSent = false;
			sendRequested = false;
			return;
		}
		if (method === 'email' && sendCode && !sendRequested) {
			sendRequested = true;
			untrack(send);
		}
	});
</script>

<Dialog.Root
	{open}
	onOpenChange={(value) => {
		if (value || !verifying) {
			open = value;
		}
	}}
>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">{title}</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">{description}</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4 pt-4"
			onsubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			{@render children?.()}

			{#if method === 'passkey'}
				<div class="flex items-center gap-3 rounded-sm border border-border bg-background/40 p-3">
					<Fingerprint class="size-5 shrink-0 text-muted-foreground" />
					<p class="text-sm text-muted-foreground">
						Your browser will ask you to authenticate with your registered passkey.
					</p>
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label>{method === 'totp' ? 'Authenticator Code' : 'Email Verification Code'}</Label>
					<Input
						bind:value={code}
						inputmode="numeric"
						placeholder="000000"
						maxlength={6}
						autocomplete="one-time-code"
					/>
					{#if showEmailHint}
						<p class="text-xs text-muted-foreground">{emailHint}</p>
					{/if}
				</div>
			{/if}

			{#if errorMessage}
				<p class="text-xs text-red-400">{errorMessage}</p>
			{/if}

			<Dialog.Footer class="flex items-center gap-2 pt-2">
				{#if method === 'email' && sendCode}
					<Button
						variant="outline"
						type="button"
						size="sm"
						class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={send}
						disabled={sending || verifying}
					>
						{sending ? 'Sending...' : 'Resend Code'}
					</Button>
				{/if}
				<Button
					variant="outline"
					type="button"
					size="sm"
					class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => (open = false)}
					disabled={verifying}
				>
					Cancel
				</Button>
				<Button
					variant={destructive ? 'destructive' : 'default'}
					type="submit"
					size="sm"
					class="gap-1.5 text-xs"
					disabled={submitDisabled}
				>
					{#if verifying}
						<Loader2 class="h-3 w-3 animate-spin" />
						{submittingLabel}
					{:else}
						{#if destructive}
							<Trash2 class="h-3 w-3" />
						{/if}
						{method === 'passkey' ? passkeySubmitLabel : submitLabel}
					{/if}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
