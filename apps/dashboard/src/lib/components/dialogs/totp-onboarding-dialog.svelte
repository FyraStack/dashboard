<script lang="ts">
	import QRCode from 'qrcode-svg';
	import { authClient } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import Check from '~icons/lucide/check';
	import Copy from '~icons/nucleo/copy';
	import ShieldCheck from '~icons/nucleo/shield-check';

	type Props = {
		open?: boolean;
		onComplete?: () => void;
	};

	let { open = $bindable(false), onComplete }: Props = $props();

	let step = $state<'password' | 'verify'>('password');
	let setupPassword = $state('');
	let setupSubmitting = $state(false);
	let totpUri = $state('');
	let secretKey = $state('');
	let backupCodes = $state<string[]>([]);
	let verifyCode = $state('');
	let verifying = $state(false);
	let verifyError = $state('');
	let copiedSecret = $state(false);
	let copiedBackup = $state(false);

	let qrSvg = $derived(
		totpUri
			? new QRCode({
					content: totpUri,
					width: 180,
					height: 180,
					padding: 0,
					color: '#fafafa',
					background: '#27272a',
					ecl: 'M'
				}).svg()
			: ''
	);
	let qrCodeSrc = $derived(qrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}` : '');
	let normalizedVerifyCode = $derived(verifyCode.replace(/\D/g, ''));
	const invalidCodeMessage =
		'Invalid code. Use the newest scanned Fyra entry and make sure your device time is set automatically.';

	const getVerifyErrorMessage = (message?: string) => {
		const normalizedMessage = message?.trim();

		return normalizedMessage === 'INVALID_CODE' ||
			normalizedMessage === 'Invalid code' ||
			normalizedMessage === 'Invalid code.'
			? invalidCodeMessage
			: (message ?? invalidCodeMessage);
	};

	async function enableTotp() {
		if (!setupPassword) return;
		setupSubmitting = true;
		verifyError = '';
		const { data, error } = await authClient.twoFactor.enable({
			password: setupPassword,
			issuer: 'Fyra Stack'
		});
		setupSubmitting = false;
		if (error) {
			verifyError = error.message ?? 'Failed to enable TOTP';
			return;
		}
		if (data) {
			totpUri = data.totpURI ?? '';
			const url = new URL(data.totpURI ?? '');
			secretKey = url.searchParams.get('secret') ?? '';
			backupCodes = data.backupCodes ?? [];
			step = 'verify';
		}
	}

	async function verifyTotp() {
		if (!normalizedVerifyCode) return;
		verifying = true;
		verifyError = '';
		const { error } = await authClient.twoFactor.verifyTotp({
			code: normalizedVerifyCode
		});
		verifying = false;
		if (error) {
			verifyError = getVerifyErrorMessage(error.message);
			return;
		}
		open = false;
		onComplete?.();
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
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Set Up Authenticator App</Dialog.Title>
			<Dialog.Description>
				Confirm your password, scan the QR code, then verify with a code.
			</Dialog.Description>
		</Dialog.Header>

		{#if step === 'password'}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-1.5">
					<Label>Current Password</Label>
					<Input
						bind:value={setupPassword}
						type="password"
						placeholder="********"
						onkeydown={(e) => e.key === 'Enter' && enableTotp()}
					/>
					{#if verifyError}
						<p class="text-xs text-red-400">{verifyError}</p>
					{/if}
				</div>

				<Button onclick={enableTotp} disabled={setupSubmitting || !setupPassword} class="gap-1.5">
					<ShieldCheck class="h-3.5 w-3.5" />
					{setupSubmitting ? 'Confirming...' : 'Continue'}
				</Button>
			</div>
		{:else if step === 'verify' && totpUri}
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
								<Copy class="h-3.5 w-3.5" />
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
						onkeydown={(e) => e.key === 'Enter' && verifyTotp()}
					/>
					{#if verifyError}
						<p class="text-xs text-red-400">{verifyError}</p>
					{/if}
				</div>

				<Button onclick={verifyTotp} disabled={verifying || !normalizedVerifyCode} class="gap-1.5">
					<ShieldCheck class="h-3.5 w-3.5" />
					{verifying ? 'Verifying...' : 'Verify & Enable'}
				</Button>
			</div>
		{:else if verifyError}
			<div class="py-4 text-center text-sm text-red-400">{verifyError}</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
