<script lang="ts">
	import { Section, Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		actionUrl: string;
		details: string;
		excerpt: string;
		heading: string;
		summary: string;
	}

	let { heading, summary, details, excerpt, actionUrl }: Props = $props();
</script>

<EmailLayout label="Support" {heading} preview={summary} fallbackUrl={actionUrl}>
	<Text class="mt-2 text-sm leading-5 text-gray-400">{summary}</Text>
	<Text class="mt-1 text-sm leading-5 text-gray-500">{details}</Text>
	<Section class="mt-4 border border-gray-800 bg-gray-950 p-4">
		<Text class="m-0 text-sm leading-5 text-gray-300">{excerpt}</Text>
	</Section>
	<ActionButton href={actionUrl} label="Open ticket" />
</EmailLayout>
