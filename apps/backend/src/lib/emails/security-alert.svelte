<script lang="ts">
	import { Section, Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		actionUrl?: string | null;
		alertType: string;
		details?: string | null;
		message: string;
		timestamp: string;
		userName?: string | null;
	}

	let {
		userName = null,
		alertType,
		message,
		timestamp,
		details = null,
		actionUrl = null
	}: Props = $props();
</script>

<EmailLayout
	label="Security alert"
	heading={alertType}
	preview={`Security alert: ${alertType}`}
	{userName}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">{message}</Text>
	{#if details}
		<Section class="mt-4 border border-gray-800 bg-gray-950 p-4">
			<Text class="m-0 text-sm leading-5 text-gray-300">{details}</Text>
		</Section>
	{/if}
	{#if actionUrl}
		<ActionButton href={actionUrl} label="Review activity" />
	{/if}
	{#snippet footer()}
		This alert was triggered at {timestamp}. If you did not initiate this activity, please contact
		{supportEmail}
		and secure your account immediately.
	{/snippet}
</EmailLayout>
