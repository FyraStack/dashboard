<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		actionLabel: string;
		actionUrl: string;
		body: string;
		heading: string;
		preview: string;
		userName?: string | null;
	}

	let { userName = null, heading, preview, body, actionUrl, actionLabel }: Props = $props();
</script>

<EmailLayout label="Billing" {heading} {preview} {userName} fallbackUrl={actionUrl}>
	<Text class="mt-2 text-sm leading-5 text-gray-400">{body}</Text>
	<ActionButton href={actionUrl} label={actionLabel} />
</EmailLayout>
