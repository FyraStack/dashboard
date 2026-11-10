<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		confirmationUrl: string;
		newEmail: string;
		userName?: string | null;
	}

	let { userName = null, newEmail, confirmationUrl }: Props = $props();
</script>

<EmailLayout
	label="Email change"
	heading="Confirm your email change"
	preview="Confirm your Stack email change"
	{userName}
	fallbackUrl={confirmationUrl}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Someone asked to change the email on your Stack account to {newEmail}. Confirm below and we'll
		send a verification link to the new address.
	</Text>
	<ActionButton href={confirmationUrl} label="Confirm email change" />
	{#snippet footer()}
		If you did not request this change, ignore this email, change your password, and contact
		{supportEmail}.
	{/snippet}
</EmailLayout>
