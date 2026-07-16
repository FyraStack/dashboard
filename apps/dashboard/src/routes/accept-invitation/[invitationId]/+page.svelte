<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { authClient } from '$lib/auth-client';
	import AlertCircle from '~icons/nucleo/alert-circle';
	import { isProjectRole, projectRoleLabels } from '$lib/auth/organization-permissions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let error = $state('');
	let accepting = $state(false);
	let declining = $state(false);
	let switching = $state(false);

	async function accept() {
		if (accepting || declining) return;
		error = '';
		accepting = true;
		const { data: res, error: err } = await authClient.organization.acceptInvitation({
			invitationId: data.invitationId
		});
		if (err || !res) {
			error = err?.message ?? 'Unable to accept invitation.';
			accepting = false;
			return;
		}
		await goto(`/projects/${res.member.organizationId}/servers`, { invalidateAll: true });
	}

	async function decline() {
		if (accepting || declining) return;
		error = '';
		declining = true;
		const { error: err } = await authClient.organization.rejectInvitation({
			invitationId: data.invitationId
		});
		if (err) {
			error = err.message ?? 'Unable to decline invitation.';
			declining = false;
			return;
		}
		await goto('/');
	}

	async function switchAccount() {
		switching = true;
		await authClient.signOut();
		goto(`/login?redirectTo=${encodeURIComponent(`/accept-invitation/${data.invitationId}`)}`);
	}
</script>

<svelte:head>
	<title>Invitation / Stack</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<div class="w-full max-w-xs">
		<div class="mb-10 flex items-center justify-center gap-2">
			<img src="/logo.svg" alt="Stack" class="h-5 w-5" />
			<span class="text-base font-semibold tracking-tight text-foreground">Stack</span>
		</div>

		{#if data.error}
			<div class="space-y-5">
				<h1 class="text-center text-lg font-medium text-foreground">Invitation</h1>

				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertCircle class="size-4 shrink-0" />
					{data.error}
				</div>

				{#if data.wrongAccount}
					<p class="text-center text-xs text-muted-foreground">
						You are signed in as {data.email}.
					</p>
					<Button class="w-full" loading={switching} onclick={switchAccount}>
						Sign in with a different account
					</Button>
				{/if}

				<Button variant="outline" size="sm" class="w-full" href="/">Go to dashboard</Button>
			</div>
		{:else}
			<div class="space-y-5">
				<h1 class="text-center text-lg font-medium text-foreground">
					Join {data.organizationName}
				</h1>

				<p class="text-center text-xs text-muted-foreground">
					{data.inviterEmail} invited you to join {data.organizationName}
					{#if data.role && isProjectRole(data.role)}
						with {projectRoleLabels[data.role]} access{/if}.
				</p>

				{#if error}
					<div
						class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
					>
						<AlertCircle class="size-4 shrink-0" />
						{error}
					</div>
				{/if}

				<Button class="w-full" loading={accepting} disabled={declining} onclick={accept}>
					Accept invitation
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="w-full"
					loading={declining}
					disabled={accepting}
					onclick={decline}
				>
					Decline
				</Button>

				<p class="text-center text-xs text-muted-foreground">Signed in as {data.email}</p>
			</div>
		{/if}
	</div>
</div>
