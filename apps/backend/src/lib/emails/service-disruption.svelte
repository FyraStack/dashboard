<script lang="ts">
	import { Section, Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		affectedServices?: string | null;
		body: string;
		heading: string;
		preview: string;
		severity?: string;
		status: string;
		statusUrl?: string | null;
		timestamp?: string | null;
		userName?: string | null;
	}

	let {
		userName = null,
		heading,
		preview,
		severity = 'warning',
		status,
		body,
		affectedServices = null,
		timestamp = null,
		statusUrl = null
	}: Props = $props();

	const severityStyles: Record<string, { border: string; text: string }> = {
		critical: { border: 'border-red-600', text: 'text-red-400' },
		warning: { border: 'border-amber-600', text: 'text-amber-400' },
		info: { border: 'border-sky-600', text: 'text-sky-400' },
		resolved: { border: 'border-emerald-600', text: 'text-emerald-400' }
	};
	const severityStyle = $derived(severityStyles[severity] ?? severityStyles.warning);
</script>

<EmailLayout label="Service disruption" {heading} {preview} {userName} fallbackUrl={statusUrl}>
	{#snippet lead()}
		<Section class="mt-4 [border-radius:0] border {severityStyle.border} bg-gray-950 px-4 py-3">
			<Text class="m-0 text-sm leading-5 font-semibold {severityStyle.text}">
				Status: {status}
			</Text>
			{#if affectedServices}
				<Text class="m-0 mt-1 text-sm leading-5 text-gray-300">Affected: {affectedServices}</Text>
			{/if}
			{#if timestamp}
				<Text class="m-0 mt-1 text-sm leading-5 text-gray-400">{timestamp}</Text>
			{/if}
		</Section>
	{/snippet}
	<Text class="mt-2 text-sm leading-5 text-gray-400">{body}</Text>
	{#if statusUrl}
		<ActionButton href={statusUrl} label="View status page" />
	{/if}
</EmailLayout>
