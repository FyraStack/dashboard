<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import type { UserSettingsTab } from '$lib/state/user-settings.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Avatar from '$lib/components/ui/avatar';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { authClient } from '$lib/auth-client';
	import TotpOnboardingDialog from './totp-onboarding-dialog.svelte';
	import PasskeyOnboardingDialog from './passkey-onboarding-dialog.svelte';
	import PasswordVerificationDialog from './password-verification-dialog.svelte';
	import {
		createSshKey as createSshKeyRpc,
		deleteSshKey,
		listSshKeys
	} from '$lib/remote/ssh-keys.remote';
	import { listApiTokens, createApiToken, revokeApiToken } from '$lib/remote/api-tokens.remote';
	import { getPendingEmailChange, requestEmailChange } from '$lib/remote/email-change.remote';
	import { disableTwoFactorWithVerification } from '$lib/remote/two-factor.remote';
	import { hasPassword } from '$lib/remote/password-change.remote';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '$lib/utils';
	import { confirmDestructive } from '$lib/confirm.svelte';

	import Check from '~icons/lucide/check';
	import Loader2 from '~icons/lucide/loader-2';
	import Minus from '~icons/lucide/minus';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import Copy from '~icons/nucleo/copy';
	import Eye from '~icons/nucleo/eye';
	import EyeOff from '~icons/nucleo/eye-off';
	import Fingerprint from '~icons/nucleo/fingerprint';
	import Key from '~icons/nucleo/key';
	import Lock from '~icons/nucleo/lock';
	import LogOut from '~icons/nucleo/logout';
	import Monitor from '~icons/nucleo/monitor';
	import Moon from '~icons/nucleo/moon';
	import ShieldCheck from '~icons/nucleo/shield-check';
	import Sun from '~icons/nucleo/sun';
	import SunMoon from '~icons/nucleo/sun-moon';
	import Terminal from '~icons/nucleo/terminal';
	import Trash2 from '~icons/nucleo/trash';
	import User from '~icons/nucleo/user';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { userPrefersMode, setMode } from 'mode-watcher';

	type ThemeMode = 'light' | 'dark' | 'system';

	const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'system', label: 'Auto', icon: Monitor }
	];

	type Props = {
		open?: boolean;
		activeTab?: UserSettingsTab;
		profileName?: string;
		user: { name?: string | null; email?: string | null };
	};

	let {
		open = $bindable(false),
		activeTab = $bindable<UserSettingsTab>('profile'),
		profileName = $bindable(''),
		user
	}: Props = $props();

	let profileSaving = $state(false);
	let profileSaved = $state(false);
	let profileEmail = $state('');
	let profileError = $state('');
	let profileEmailChangePending = $state(false);
	let pendingProfileEmail = $state('');
	const currentProfileEmail = $derived(user?.email ?? '');
	const normalizedProfileEmail = $derived(profileEmail.trim().toLowerCase());
	const profileEmailChanged = $derived(
		normalizedProfileEmail !== currentProfileEmail.toLowerCase()
	);
	const profileSaveDisabled = $derived(profileSaving || !profileEmail.trim());

	$effect(() => {
		if (!open) return;
		untrack(() => {
			profileSaved = false;
			profileError = '';
			profileEmail = currentProfileEmail;
			profileEmailChangePending = false;
			pendingProfileEmail = '';
		});
	});

	async function saveProfile() {
		if (profileSaving) return;
		profileSaving = true;
		profileSaved = false;
		profileError = '';

		const originalName = user?.name ?? '';
		const originalEmail = currentProfileEmail;
		const nextName = profileName.trim() || originalName;
		const nextEmail = normalizedProfileEmail;
		profileName = nextName;
		profileEmail = nextEmail || originalEmail;

		if (!nextEmail) {
			profileError = 'Enter an email address.';
			profileSaving = false;
			return;
		}

		try {
			if (nextName !== originalName) {
				const { error } = await authClient.updateUser({ name: nextName });

				if (error) {
					profileError = error.message ?? 'Failed to update profile.';
					return;
				}
			}

			if (profileEmailChanged) {
				const result = await requestEmailChange({
					newEmail: nextEmail,
					callbackURL: window.location.pathname + window.location.search
				});

				profileEmailChangePending = true;
				pendingProfileEmail = result.email;
			}

			profileSaved = true;
			setTimeout(() => (profileSaved = false), 1500);
		} catch (error) {
			console.error('Failed to update profile:', error);
			profileError = getErrorMessage(error, 'Failed to update profile.');
			profileName = originalName;
			profileEmail = originalEmail;
		} finally {
			profileSaving = false;
		}
	}

	async function loadPendingProfileEmailChange() {
		pendingProfileEmail = (await getPendingEmailChange()) ?? '';
		profileEmailChangePending = Boolean(pendingProfileEmail);
	}

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let showPassword = $state(false);
	let passwordSaved = $state(false);
	let passwordError = $state('');
	let passwordVerificationOpen = $state(false);
	let passwordVerificationPreparing = $state(false);
	let userHasPassword = $state<boolean | null>(null);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			void (async () => {
				try {
					userHasPassword = await await hasPassword();
				} catch {
					userHasPassword = null;
				}
			})();
		});
	});

	async function beginPasswordChange() {
		if (
			passwordVerificationOpen ||
			passwordVerificationPreparing ||
			(userHasPassword && !currentPassword) ||
			!newPassword ||
			newPassword !== confirmPassword
		) {
			return;
		}

		passwordError = '';
		passwordSaved = false;
		passwordVerificationPreparing = true;
		try {
			await loadTwoFactorStatus();
			passwordVerificationOpen = true;
		} finally {
			passwordVerificationPreparing = false;
		}
	}

	function onPasswordVerified() {
		passwordSaved = true;
		currentPassword = '';
		newPassword = '';
		confirmPassword = '';
		setTimeout(() => (passwordSaved = false), 1500);
	}

	let twoFactorEnabled = $state(false);
	let passkeys = $state<{ id: string; name: string; createdAt?: string }[]>([]);
	let passkeysLoading = $state(false);
	let hasPasskey = $derived(passkeys.length > 0);
	let totpDialogOpen = $state(false);
	let passkeyDialogOpen = $state(false);
	let totpDisableDialogOpen = $state(false);
	let totpDisablePassword = $state('');
	type TotpDisableMethod = 'totp' | 'backupCode';
	let totpDisableMethod = $state<TotpDisableMethod>('totp');
	let totpDisableCode = $state('');
	let disablingTotp = $state(false);
	let totpDisableError = $state('');
	let removingPasskey = $state<string | null>(null);
	let normalizedTotpDisableCode = $derived(totpDisableCode.replace(/\D/g, '').slice(0, 6));
	let totpDisableCodeLabel = $derived(
		totpDisableMethod === 'totp' ? 'Authenticator Code' : 'Backup Code'
	);
	let totpDisableCodeValid = $derived(
		totpDisableMethod === 'totp' ? normalizedTotpDisableCode.length === 6 : Boolean(totpDisableCode)
	);
	let totpDisableSubmitDisabled = $derived(
		disablingTotp || !totpDisablePassword || !totpDisableCodeValid
	);

	async function loadTwoFactorStatus() {
		const { data: session } = await authClient.getSession();
		if (session?.user) {
			twoFactorEnabled = session.user.twoFactorEnabled ?? false;
		}
		passkeysLoading = true;
		try {
			const { data } = await authClient.passkey.listUserPasskeys();
			passkeys = (Array.isArray(data) ? data : []) as unknown as {
				id: string;
				name: string;
				createdAt?: string;
			}[];
		} catch {
			passkeys = [];
		} finally {
			passkeysLoading = false;
		}
	}

	async function disableTotp() {
		if (!totpDisablePassword) {
			totpDisableError = 'Enter your current password to disable authenticator app 2FA.';
			return;
		}

		if (!totpDisableCodeValid) {
			totpDisableError =
				totpDisableMethod === 'totp'
					? 'Enter the verification code from your authenticator app.'
					: 'Enter a backup code.';
			return;
		}

		totpDisableError = '';
		disablingTotp = true;
		try {
			await disableTwoFactorWithVerification({
				password: totpDisablePassword,
				method: totpDisableMethod,
				code: totpDisableMethod === 'totp' ? normalizedTotpDisableCode : totpDisableCode
			});

			twoFactorEnabled = false;
			totpDisableDialogOpen = false;
			totpDisablePassword = '';
			totpDisableMethod = 'totp';
			totpDisableCode = '';
			totpDisableError = '';
			currentPassword = '';
		} catch (err) {
			totpDisableError = getErrorMessage(err, 'Failed to disable authenticator app 2FA.');
		} finally {
			disablingTotp = false;
		}
	}

	async function removePasskey(id: string) {
		const passkey = passkeys.find((p) => p.id === id);
		const ok = await confirmDestructive({
			title: 'Remove passkey',
			description: `You will no longer be able to sign in with ${passkey?.name ?? 'this passkey'}.`,
			confirmWord: passkey?.name,
			confirmLabel: 'Remove passkey'
		});
		if (!ok) return;
		removingPasskey = id;
		try {
			await authClient.passkey.deletePasskey({ id });
			passkeys = passkeys.filter((p) => p.id !== id);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to remove passkey'));
		} finally {
			removingPasskey = null;
		}
	}

	let sshKeys = $state<{ id: string; name: string; fingerprint: string }[]>([]);
	let sshKeysLoaded = $state(false);
	let sshKeysLoading = $state(false);
	let sshKeyAdding = $state(false);
	let sshKeyRemoving = $state<string | null>(null);
	let newKeyName = $state('');
	let newKeyValue = $state('');
	let newKeyNameFocused = $state(false);

	$effect(() => {
		if (!newKeyNameFocused && newKeyValue != '' && newKeyName == '') {
			newKeyName = newKeyValue.split(' ')[2] ?? '';
		}
	});

	async function loadSshKeys() {
		if (sshKeysLoaded || sshKeysLoading) return;
		sshKeysLoading = true;
		try {
			sshKeys = await listSshKeys();
			sshKeysLoaded = true;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to load SSH keys'));
		} finally {
			sshKeysLoading = false;
		}
	}

	async function addSshKey() {
		if (!newKeyName.trim() || !newKeyValue.trim() || sshKeyAdding) return;
		sshKeyAdding = true;
		try {
			const res = await createSshKeyRpc({
				name: newKeyName.trim(),
				publicKey: newKeyValue.trim()
			});
			await invalidate('app:ssh-keys');
			sshKeys.push({ id: res.id, name: newKeyName.trim(), fingerprint: res.fingerprint });
			newKeyName = '';
			newKeyValue = '';
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to add SSH key'));
		} finally {
			sshKeyAdding = false;
		}
	}

	async function removeSshKey(id: string) {
		if (sshKeyRemoving) return;
		const key = sshKeys.find((k) => k.id === id);
		const ok = await confirmDestructive({
			title: 'Delete SSH key',
			description: `Anything relying on ${key?.name ?? 'this key'} for access will stop working.`,
			confirmWord: key?.name,
			confirmLabel: 'Delete SSH key'
		});
		if (!ok) return;
		sshKeyRemoving = id;
		sshKeys = sshKeys.filter((k) => k.id !== id);
		try {
			await deleteSshKey({ keyId: id });
			await invalidate('app:ssh-keys');
		} catch (err) {
			sshKeys = [...sshKeys, key!];
			toast.error(getErrorMessage(err, 'Failed to remove SSH key'));
		} finally {
			sshKeyRemoving = null;
		}
	}

	type ApiTokenState = {
		id: string;
		name: string;
		created: string;
		lastUsedAt: number | null;
	};
	let tokens = $state<ApiTokenState[]>([]);
	let tokensLoading = $state(false);
	let newTokenName = $state('');
	let generatedToken = $state('');
	let copiedTokenId = $state<string | null>(null);

	async function loadTokens() {
		if (tokensLoading || tokens.length > 0) return;
		tokensLoading = true;
		try {
			const result = await listApiTokens();
			tokens = result.map((t) => ({
				id: t.id,
				name: t.name,
				created: new Date(t.createdAt).toISOString().slice(0, 10),
				lastUsedAt: t.lastUsedAt
			}));
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to load API tokens'));
		} finally {
			tokensLoading = false;
		}
	}

	async function generateToken() {
		if (!newTokenName.trim()) return;
		const name = newTokenName.trim();
		const tempId = `temp-${Date.now()}`;
		const now = new Date().toISOString().slice(0, 10);

		tokens.push({ id: tempId, name, created: now, lastUsedAt: null });

		try {
			const result = await createApiToken({ name });
			generatedToken = result.token;
			const idx = tokens.findIndex((t) => t.id === tempId);
			if (idx !== -1) tokens[idx] = { ...tokens[idx], id: result.id };
		} catch (err) {
			tokens = tokens.filter((t) => t.id !== tempId);
			toast.error(getErrorMessage(err, 'Failed to create API token'));
		} finally {
			newTokenName = '';
		}
	}

	async function revokeToken(id: string) {
		const idx = tokens.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const tokenToRemove = tokens[idx];
		const ok = await confirmDestructive({
			title: 'Revoke API token',
			description: `Any integrations using ${tokenToRemove.name} will immediately stop working.`,
			confirmWord: tokenToRemove.name,
			confirmLabel: 'Revoke token'
		});
		if (!ok) return;
		tokens = tokens.filter((t) => t.id !== id);

		try {
			await revokeApiToken({ tokenId: id });
		} catch (err) {
			tokens.splice(idx, 0, tokenToRemove);
			toast.error(getErrorMessage(err, 'Failed to revoke API token'));
		}
	}

	function copyToken(tokenId: string, showFullToken: string | null) {
		if (!showFullToken) return;
		navigator.clipboard.writeText(showFullToken);
		copiedTokenId = tokenId;
		setTimeout(() => (copiedTokenId = null), 1500);
	}

	async function signOut() {
		await authClient.signOut();
		goto(resolve('/login'));
	}

	$effect(() => {
		if (!open) return;
		untrack(() => {
			void Promise.all([
				loadSshKeys(),
				loadTokens(),
				loadTwoFactorStatus(),
				loadPendingProfileEmailChange()
			]);
		});
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex h-[80dvh] w-full max-w-[calc(100%-2rem)] flex-col overflow-hidden border-border bg-background p-0 sm:h-[28rem] sm:max-w-4xl"
		showCloseButton={false}
	>
		<DialogPrimitive.Close data-slot="dialog-close" class="absolute top-3 right-3 z-50">
			{#snippet child({ props })}
				<button
					type="button"
					class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
					{...props}
				>
					<X class="h-4 w-4" />
					<span class="sr-only">Close</span>
				</button>
			{/snippet}
		</DialogPrimitive.Close>
		<Tabs.Root
			bind:value={activeTab}
			orientation="vertical"
			class="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row"
		>
			<div class="flex w-full flex-col border-b border-border sm:w-52 sm:border-r sm:border-b-0">
				<div class="px-5 pt-5 pb-4">
					<div class="flex items-center gap-3">
						<Avatar.Root class="h-9 w-9 border border-border">
							<Avatar.Fallback class="bg-red-500/10 text-xs font-semibold text-red-400">
								{(user?.name ?? '??')
									.split(' ')
									.map((n: string) => n[0])
									.join('')
									.slice(0, 2)
									.toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-foreground">{profileName}</p>
							<p class="truncate text-xs text-muted-foreground">{profileEmail}</p>
						</div>
					</div>
				</div>

				<Tabs.List variant="line" class="flex-col items-start gap-0 bg-transparent px-3">
					<Tabs.Trigger
						value="profile"
						class="w-full justify-start gap-2 rounded-none border-0 px-3 py-2 text-muted-foreground after:hidden data-active:bg-transparent data-active:text-foreground"
					>
						<User class="size-4" />
						Profile
					</Tabs.Trigger>
					<Tabs.Trigger
						value="security"
						class="w-full justify-start gap-2 rounded-none border-0 px-3 py-2 text-muted-foreground after:hidden data-active:bg-transparent data-active:text-foreground"
					>
						<Lock class="size-4" />
						Security
					</Tabs.Trigger>
					<Tabs.Trigger
						value="keys"
						class="w-full justify-start gap-2 rounded-none border-0 px-3 py-2 text-muted-foreground after:hidden data-active:bg-transparent data-active:text-foreground"
					>
						<Key class="size-4" />
						Keys
					</Tabs.Trigger>
					<Tabs.Trigger
						value="api"
						class="w-full justify-start gap-2 rounded-none border-0 px-3 py-2 text-muted-foreground after:hidden data-active:bg-transparent data-active:text-foreground"
					>
						<Terminal class="size-4" />
						API
					</Tabs.Trigger>
					<Tabs.Trigger
						value="appearance"
						class="w-full justify-start gap-2 rounded-none border-0 px-3 py-2 text-muted-foreground after:hidden data-active:bg-transparent data-active:text-foreground"
					>
						<SunMoon class="size-4" />
						Appearance
					</Tabs.Trigger>
				</Tabs.List>
			</div>

			<div class="relative flex min-h-0 flex-1 flex-col">
				<div class="h-4 shrink-0"></div>
				<div class="settings-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto">
					<Tabs.Content value="profile" class="mt-0 px-6 py-6">
						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<User class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									Profile
								</p>
							</div>
							<div class="flex flex-col gap-3">
								<div class="flex flex-col gap-1.5">
									<Label>Full Name</Label>
									<Input bind:value={profileName} />
								</div>
								<div class="flex flex-col gap-1.5">
									<Label>Email Address</Label>
									<Input bind:value={profileEmail} type="email" />
									{#if profileEmailChangePending}
										<p class="text-xs text-muted-foreground">
											Check {pendingProfileEmail} to verify this email change.
										</p>
									{/if}
								</div>
								{#if profileError}
									<p class="text-xs text-red-400">{profileError}</p>
								{/if}
								<Button
									size="sm"
									onclick={saveProfile}
									disabled={profileSaveDisabled}
									class="w-fit"
								>
									{#if profileSaving}
										Saving...
									{:else if profileSaved}
										<Check class="h-3 w-3" />
										{profileEmailChangePending ? 'Verification sent' : 'Saved'}
									{:else}
										Save Profile
									{/if}
								</Button>
							</div>
						</div>
					</Tabs.Content>

					<Tabs.Content value="security" class="mt-0 space-y-4 px-6 py-6">
						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<Lock class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									Password
								</p>
							</div>
							<div class="flex flex-col gap-3">
								{#if userHasPassword}
									<div class="flex flex-col gap-1.5">
										<Label>Current Password</Label>
										<div class="relative">
											<Input
												bind:value={currentPassword}
												type={showPassword ? 'text' : 'password'}
												placeholder="********"
											/>
											<button
												type="button"
												class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
												onclick={() => (showPassword = !showPassword)}
											>
												{#if showPassword}
													<EyeOff class="size-4" />
												{:else}
													<Eye class="size-4" />
												{/if}
											</button>
										</div>
									</div>
								{/if}
								<div class="flex flex-col gap-1.5">
									<Label>New Password</Label>
									<Input bind:value={newPassword} type="password" placeholder="********" />
								</div>
								<div class="flex flex-col gap-1.5">
									<Label>Confirm New Password</Label>
									<Input bind:value={confirmPassword} type="password" placeholder="********" />
									{#if confirmPassword && newPassword !== confirmPassword}
										<p class="text-xs text-red-400">Passwords do not match.</p>
									{/if}
								</div>
								{#if passwordError}
									<p class="text-xs text-red-400">{passwordError}</p>
								{/if}
								<Button
									size="sm"
									onclick={beginPasswordChange}
									disabled={passwordVerificationOpen ||
										passwordVerificationPreparing ||
										(userHasPassword && !currentPassword) ||
										!newPassword ||
										newPassword !== confirmPassword}
									class="w-fit"
								>
									{#if passwordVerificationPreparing}
										Preparing...
									{:else if passwordSaved}
										<Check class="h-3 w-3" /> Updated
									{:else}
										Update Password
									{/if}
								</Button>
							</div>
						</div>

						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<ShieldCheck class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									Two-Factor Authentication
								</p>
							</div>

							<div class="flex items-center justify-between py-2.5">
								<div class="flex items-center gap-2.5">
									<ShieldCheck class="h-4 w-4 text-muted-foreground" />
									<div>
										<p class="text-sm font-medium text-foreground">Authenticator App</p>
										<p class="text-xs text-muted-foreground">
											{twoFactorEnabled ? 'Enabled' : 'Not configured'}
										</p>
									</div>
								</div>
								{#if twoFactorEnabled}
									<Button
										variant="destructive"
										size="sm"
										class="h-7 w-20 gap-1.5 text-xs"
										onclick={() => {
											totpDisableError = '';
											totpDisablePassword = '';
											totpDisableMethod = 'totp';
											totpDisableCode = '';
											totpDisableDialogOpen = true;
										}}
									>
										<Minus class="h-3 w-3" />
										Disable
									</Button>
								{:else}
									<Button
										variant="outline"
										size="sm"
										class="h-7 gap-1.5 text-xs"
										onclick={() => (totpDialogOpen = true)}
									>
										<Plus class="h-3 w-3" />
										Set Up
									</Button>
								{/if}
							</div>
							<div class="border-t border-border/50"></div>

							<div class="py-2.5">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2.5">
										<Fingerprint class="h-4 w-4 text-muted-foreground" />
										<div>
											<p class="text-sm font-medium text-foreground">Passkeys</p>
											<p class="text-xs text-muted-foreground">
												{passkeys.length > 0 ? `${passkeys.length} registered` : 'Not configured'}
											</p>
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										class="h-7 w-20 gap-1.5 text-xs"
										onclick={() => (passkeyDialogOpen = true)}
									>
										<Plus class="h-3 w-3" />
										Add
									</Button>
								</div>

								{#if passkeysLoading && passkeys.length === 0}
									<div class="mt-2 flex flex-col gap-2">
										{#each Array.from({ length: 2 }) as _, index (index)}
											<div
												class="flex items-center gap-2.5 rounded-xs border border-border/60 bg-background px-3 py-2"
											>
												<Skeleton class="size-4 shrink-0 rounded-full" />
												<div class="min-w-0 flex-1 space-y-1.5">
													<Skeleton class="h-3 w-32" />
													<Skeleton class="h-2.5 w-20" />
												</div>
											</div>
										{/each}
									</div>
								{:else if passkeys.length > 0}
									<div class="mt-2 flex flex-col gap-2">
										{#each passkeys as pk (pk.id)}
											<div
												class="flex items-center gap-2.5 rounded-xs border border-border/60 bg-background px-3 py-2"
											>
												<Fingerprint class="size-4 shrink-0 text-muted-foreground" />
												<div class="min-w-0">
													<p class="truncate text-sm text-foreground">{pk.name || 'Unnamed'}</p>
													{#if pk.createdAt}
														<p class="text-xs text-muted-foreground">
															Added {new Date(pk.createdAt).toISOString().slice(0, 10)}
														</p>
													{/if}
												</div>
												<Button
													variant="ghost"
													size="sm"
													class="ml-auto h-7 w-7 shrink-0 p-0 text-red-400 hover:text-red-300"
													onclick={() => removePasskey(pk.id)}
													disabled={removingPasskey === pk.id}
												>
													<Trash2 class="h-3 w-3" />
												</Button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<div class="rounded-xs border border-red-500/20 bg-red-500/5 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-red-500/10 pb-2">
								<LogOut class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-red-400/80 uppercase">
									Session
								</p>
							</div>
							<button
								type="button"
								class="flex w-full items-center justify-center gap-2 rounded-xs border border-red-500/20 bg-transparent px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
								onclick={signOut}
							>
								<LogOut class="size-4" />
								Sign Out
							</button>
						</div>
					</Tabs.Content>

					<Tabs.Content value="keys" class="mt-0 space-y-4 px-6 py-6">
						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<Key class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									SSH Keys
								</p>
								<a
									href="https://fyrastack.com/docs/vps/ssh"
									target="_blank"
									rel="noopener noreferrer"
									class="ml-auto text-[11px] font-medium text-red-400 transition-colors hover:text-red-300"
								>
									SSH docs
								</a>
							</div>

							{#if sshKeysLoading}
								<div class="divide-y divide-border/50">
									{#each Array.from({ length: 2 }) as _, index (index)}
										<div class="flex items-center justify-between py-2.5">
											<div class="min-w-0 flex-1 space-y-1.5">
												<Skeleton class="h-3.5 w-28" />
												<Skeleton class="h-2.5 w-44" />
											</div>
											<Skeleton class="h-7 w-7 shrink-0" />
										</div>
									{/each}
								</div>
							{:else if sshKeys.length > 0}
								<div class="max-h-48 overflow-y-auto">
									<div class="divide-y divide-border/50">
										{#each sshKeys as key (key.id)}
											<div class="flex items-center justify-between py-2.5">
												<div class="min-w-0">
													<p class="truncate text-sm font-medium text-foreground">{key.name}</p>
													<p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
														{key.fingerprint}
													</p>
												</div>
												<Button
													variant="ghost"
													size="sm"
													class="h-7 w-7 shrink-0 p-0 text-red-400 hover:text-red-300"
													onclick={() => removeSshKey(key.id)}
													disabled={sshKeyRemoving === key.id}
												>
													<Trash2 class="h-3 w-3" />
												</Button>
											</div>
										{/each}
									</div>
								</div>
							{:else}
								<p class="py-2 text-center text-xs text-muted-foreground">No SSH keys added.</p>
							{/if}

							<div class="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3">
								<Input
									bind:value={newKeyName}
									placeholder="Key name"
									class="h-8 text-xs"
									onfocus={() => (newKeyNameFocused = true)}
									onblur={() => (newKeyNameFocused = false)}
								/>
								<textarea
									bind:value={newKeyValue}
									placeholder="ssh-ed25519 AAAA..."
									rows="3"
									class="w-full resize-none border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
								></textarea>
								<Button
									variant="outline"
									size="sm"
									class="w-fit gap-1.5 text-xs"
									onclick={addSshKey}
									disabled={!newKeyName.trim() || !newKeyValue.trim() || sshKeyAdding}
								>
									{#if sshKeyAdding}
										<Loader2 class="h-3 w-3 animate-spin" />
										Adding...
									{:else}
										<Plus class="h-3 w-3" />
										Add Key
									{/if}
								</Button>
							</div>
						</div>
					</Tabs.Content>

					<Tabs.Content value="api" class="mt-0 flex-1 overflow-y-auto px-6 py-6">
						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<Key class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									API Tokens
								</p>
							</div>

							{#if generatedToken}
								<div
									class="mb-3 border border-amber-300 bg-amber-100 p-3 dark:border-amber-800/50 dark:bg-amber-950/20"
								>
									<p class="text-xs font-medium text-amber-800 dark:text-amber-400">
										Copy this token now. It won't be shown again.
									</p>
									<div class="mt-2 flex items-center gap-2">
										<code
											class="flex-1 overflow-hidden bg-muted px-2 py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-foreground"
										>
											{generatedToken}
										</code>
										<button
											type="button"
											class="shrink-0 text-muted-foreground hover:text-foreground"
											onclick={() => copyToken('new-token', generatedToken)}
										>
											{#if copiedTokenId === 'new-token'}
												<Check class="h-3.5 w-3.5 text-emerald-500" />
											{:else}
												<Copy class="size-4" />
											{/if}
										</button>
									</div>
								</div>
							{/if}

							{#if tokensLoading}
								<div class="divide-y divide-border/50">
									{#each Array.from({ length: 2 }) as _, index (index)}
										<div class="flex items-center justify-between py-2.5">
											<div class="min-w-0 flex-1 space-y-1.5">
												<Skeleton class="h-3.5 w-24" />
												<Skeleton class="h-2.5 w-40" />
											</div>
											<Skeleton class="h-7 w-14 shrink-0" />
										</div>
									{/each}
								</div>
							{:else if tokens.length > 0}
								<div class="max-h-48 overflow-y-auto">
									<div class="divide-y divide-border/50">
										{#each tokens as token (token.id)}
											<div class="flex items-center justify-between py-2.5">
												<div class="min-w-0">
													<p class="truncate text-sm font-medium text-foreground">{token.name}</p>
													<p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
														sk-stack-****...****
														<span class="ml-2 font-sans text-muted-foreground"
															>Created {token.created}</span
														>
													</p>
												</div>
												<Button
													variant="ghost"
													size="sm"
													class="h-7 shrink-0 px-2 text-xs text-red-400 hover:text-red-300"
													onclick={() => revokeToken(token.id)}
												>
													Revoke
												</Button>
											</div>
										{/each}
									</div>
								</div>
							{:else}
								<p class="py-2 text-center text-xs text-muted-foreground">No API tokens.</p>
							{/if}

							<div class="mt-3 flex items-center gap-3 border-t border-border/50 pt-3">
								<Input bind:value={newTokenName} placeholder="Token name" class="h-8 text-xs" />
								<Button
									variant="outline"
									size="sm"
									class="shrink-0 gap-1.5 text-xs"
									onclick={generateToken}
									disabled={!newTokenName.trim()}
								>
									<Plus class="h-3 w-3" />
									Generate
								</Button>
							</div>
						</div>
					</Tabs.Content>

					<Tabs.Content value="appearance" class="mt-0 px-6 py-6">
						<div class="rounded-xs border border-border/60 p-4">
							<div class="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
								<SunMoon class="size-4 text-red-400" />
								<p class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
									Appearance
								</p>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label>Theme</Label>
								<div class="grid grid-cols-3 gap-2">
									{#each themeOptions as option (option.value)}
										{@const Icon = option.icon}
										<button
											type="button"
											onclick={() => setMode(option.value)}
											class="flex flex-col items-center gap-1.5 border px-3 py-2.5 text-xs transition-colors {userPrefersMode.current ===
											option.value
												? 'border-primary bg-primary/10 text-foreground'
												: 'border-border text-muted-foreground hover:border-ring hover:text-foreground'}"
										>
											<Icon class="h-4 w-4" />
											{option.label}
										</button>
									{/each}
								</div>
								<p class="mt-1.5 text-xs text-muted-foreground">
									Auto follows your system's light/dark setting.
								</p>
							</div>
						</div>
					</Tabs.Content>
				</div>
			</div>
		</Tabs.Root>
	</Dialog.Content>

	{#if totpDialogOpen}
		<TotpOnboardingDialog bind:open={totpDialogOpen} onComplete={loadTwoFactorStatus} />
	{/if}
	<PasskeyOnboardingDialog bind:open={passkeyDialogOpen} onComplete={loadTwoFactorStatus} />
	<PasswordVerificationDialog
		bind:open={passwordVerificationOpen}
		hasPassword={userHasPassword ?? false}
		{hasPasskey}
		{twoFactorEnabled}
		{currentPassword}
		{newPassword}
		onVerified={onPasswordVerified}
	/>
	<Dialog.Root bind:open={totpDisableDialogOpen}>
		<Dialog.Content class="border-border bg-background sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Disable Authenticator App</Dialog.Title>
				<Dialog.Description>
					Disabling authenticator app two-factor authentication requires your current password plus
					a current authenticator code or backup code.
				</Dialog.Description>
			</Dialog.Header>

			<form
				class="flex flex-col gap-4 py-4"
				onsubmit={(e) => {
					e.preventDefault();
					void disableTotp();
				}}
			>
				<div class="flex flex-col gap-1.5">
					<Label>Current Password</Label>
					<Input
						bind:value={totpDisablePassword}
						type="password"
						placeholder="********"
						autocomplete="current-password"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label>Verification Method</Label>
					<div class="flex rounded-xs border border-border bg-background/40 p-1">
						<button
							type="button"
							class={[
								'flex-1 rounded-xs px-3 py-1.5 text-xs font-medium transition-colors',
								totpDisableMethod === 'totp'
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							]}
							onclick={() => {
								totpDisableMethod = 'totp';
								totpDisableCode = '';
								totpDisableError = '';
							}}
						>
							Authenticator code
						</button>
						<button
							type="button"
							class={[
								'flex-1 rounded-xs px-3 py-1.5 text-xs font-medium transition-colors',
								totpDisableMethod === 'backupCode'
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							]}
							onclick={() => {
								totpDisableMethod = 'backupCode';
								totpDisableCode = '';
								totpDisableError = '';
							}}
						>
							Backup code
						</button>
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label>{totpDisableCodeLabel}</Label>
					{#if totpDisableMethod === 'totp'}
						<Input
							bind:value={totpDisableCode}
							inputmode="numeric"
							pattern="[0-9]*"
							placeholder="000000"
							maxlength={6}
							autocomplete="one-time-code"
						/>
					{:else}
						<Input
							bind:value={totpDisableCode}
							type="text"
							placeholder="Backup code"
							autocomplete="off"
						/>
					{/if}
					{#if totpDisableError}
						<p class="text-xs text-red-400">{totpDisableError}</p>
					{/if}
				</div>

				<Dialog.Footer>
					<Button
						variant="outline"
						type="button"
						onclick={() => (totpDisableDialogOpen = false)}
						disabled={disablingTotp}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						type="submit"
						class="gap-1.5"
						disabled={totpDisableSubmitDisabled}
					>
						{#if !disablingTotp}
							<Minus class="h-3 w-3" />
						{/if}
						{disablingTotp ? 'Disabling...' : 'Disable'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
</Dialog.Root>

<style>
	:global(.settings-scroll) {
		scrollbar-gutter: stable;
		scrollbar-color: transparent transparent;
		scrollbar-width: thin;
	}
	:global(.settings-scroll:hover) {
		scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
	}
	:global(.settings-scroll::-webkit-scrollbar) {
		width: 5px;
	}
	:global(.settings-scroll::-webkit-scrollbar-track) {
		background: transparent;
	}
	:global(.settings-scroll::-webkit-scrollbar-thumb) {
		background-color: transparent;
		border-radius: 9999px;
		transition: background-color 0.2s;
	}
	:global(.settings-scroll:hover::-webkit-scrollbar-thumb) {
		background-color: rgba(255, 255, 255, 0.12);
	}
	:global(.settings-scroll::-webkit-scrollbar-thumb:hover) {
		background-color: rgba(198, 113, 109, 0.4);
	}
	:global(.settings-scroll::-webkit-scrollbar-corner) {
		background: transparent;
	}
</style>
