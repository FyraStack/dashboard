<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		userName?: string | null;
		verificationUrl: string;
	}

	let { userName = null, verificationUrl }: Props = $props();
</script>

<EmailLayout
	label="Email verification"
	heading="Verify this email"
	preview="Verify your Stack email"
	{userName}
	fallbackUrl={verificationUrl}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Please verify this email address for your Stack account.
	</Text>
	<ActionButton href={verificationUrl} label="Verify email" />
	{#snippet footer()}
		If you did not request this email verification, contact {supportEmail}.
	{/snippet}
</EmailLayout>
