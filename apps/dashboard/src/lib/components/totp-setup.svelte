<script lang="ts">
	import QRCode from 'qrcode';
	import { authClient } from '#lib/auth-client.js';
	import { Clipboard } from '#lib/clipboard.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import Check from '~icons/lucide/check';
	import Copy from '~icons/nucleo/copy';
	import ShieldCheck from '~icons/nucleo/shield-check';

	interface Props {
		backupCodes: string[];
		onComplete: () => void;
		submitLabel: string;
		totpUri: string;
	}

	let { totpUri, backupCodes, submitLabel, onComplete }: Props = $props();

	const secretKey = $derived(new URL(totpUri).searchParams.get('secret') ?? '');
	let qrCodeSrc = $state('');
	let verifyCode = $state('');
	let verifying = $state(false);
	let verifyError = $state('');
	const clipboard = new Clipboard();

	const normalizedVerifyCode = $derived(verifyCode.replace(/\D/g, ''));
	const invalidCodeMessage =
		'Invalid code. Use the newest scanned Fyra entry and make sure your device time is set automatically.';

	function getVerifyErrorMessage(message?: string) {
		const normalizedMessage = message?.trim();
		return normalizedMessage === 'INVALID_CODE' ||
			normalizedMessage === 'Invalid code' ||
			normalizedMessage === 'Invalid code.'
			? invalidCodeMessage
			: (message ?? invalidCodeMessage);
	}

	async function verify() {
		if (!normalizedVerifyCode || verifying) {
			return;
		}
		verifying = true;
		verifyError = '';
		const { error } = await authClient.twoFactor.verifyTotp({ code: normalizedVerifyCode });
		verifying = false;
		if (error) {
			verifyError = getVerifyErrorMessage(error.message);
			return;
		}
		onComplete();
	}

	$effect(() => {
		let cancelled = false;
		QRCode.toDataURL(totpUri, {
			width: 180,
			margin: 0,
			color: { dark: '#fafafa', light: '#27272a' },
			errorCorrectionLevel: 'M'
		})
			.then((src) => {
				if (!cancelled) {
					qrCodeSrc = src;
				}
			})
			.catch(() => {
				if (!cancelled) {
					qrCodeSrc = '';
				}
			});
		return () => {
			cancelled = true;
		};
	});
</script>

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
				onclick={() => clipboard.copy(secretKey, 'secret')}
			>
				{#if clipboard.copiedKey === 'secret'}
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
					onclick={() => clipboard.copy(backupCodes.join('\n'), 'backup')}
				>
					{#if clipboard.copiedKey === 'backup'}
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
			onkeydown={(e) => e.key === 'Enter' && verify()}
		/>
		{#if verifyError}
			<p class="text-xs text-red-400">{verifyError}</p>
		{/if}
	</div>

	<Button onclick={verify} disabled={verifying || !normalizedVerifyCode} class="gap-1.5">
		<ShieldCheck class="size-4" />
		{verifying ? 'Verifying...' : submitLabel}
	</Button>
</div>
