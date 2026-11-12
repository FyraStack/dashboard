<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		resetUrl: string;
		userName?: string | null;
	}

	let { userName = null, resetUrl }: Props = $props();
</script>

<EmailLayout
	label="Password reset"
	heading="Reset your password"
	preview="Reset your Stack password"
	{userName}
	fallbackUrl={resetUrl}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Use the button below to reset your Stack password and get back into your account.
	</Text>
	<ActionButton href={resetUrl} label="Reset password" />
	{#snippet footer()}
		If you did not request a password reset, you can safely ignore this email.
	{/snippet}
</EmailLayout>
