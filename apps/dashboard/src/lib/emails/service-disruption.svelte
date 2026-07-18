<script lang="ts">
	import {
		Body,
		Button,
		Container,
		Head,
		Heading,
		Hr,
		Html,
		Preview,
		Section,
		Text
	} from '@better-svelte-email/components';
	import EmailHeader from './email-header.svelte';

	interface Props {
		userName?: string | null;
		heading: string;
		preview: string;
		severity?: string;
		status: string;
		body: string;
		affectedServices?: string | null;
		timestamp?: string | null;
		statusUrl?: string | null;
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

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview {preview} />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Service disruption" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">{heading}</Heading>
				<Section class="mt-4 [border-radius:0] border {severityStyle.border} bg-gray-950 px-4 py-3">
					<Text class="m-0 text-sm leading-5 font-semibold {severityStyle.text}">
						Status: {status}
					</Text>
					{#if affectedServices}
						<Text class="m-0 mt-1 text-sm leading-5 text-gray-300">
							Affected: {affectedServices}
						</Text>
					{/if}
					{#if timestamp}
						<Text class="m-0 mt-1 text-sm leading-5 text-gray-400">{timestamp}</Text>
					{/if}
				</Section>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					{#if userName}Hi {userName},{:else}Hi there,{/if}
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">{body}</Text>
				{#if statusUrl}
					<Section class="mt-6">
						<Button
							href={statusUrl}
							pX={24}
							pY={14}
							class="[border-radius:0] border border-red-500 bg-red-500 font-semibold text-white"
						>
							View status page
						</Button>
					</Section>
					<Hr class="my-8 border-gray-800" />
					<Text class="text-sm leading-5 text-gray-500">
						If the button above doesn't work, copy and paste this URL into your browser:
					</Text>
					<Text class="mt-1 text-sm leading-5 break-all text-gray-500">
						<a href={statusUrl} class="break-all text-red-400 no-underline">{statusUrl}</a>
					</Text>
				{/if}
			</Section>
		</Container>
	</Body>
</Html>
