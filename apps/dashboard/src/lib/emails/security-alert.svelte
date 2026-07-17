<script lang="ts">
	import {
		Body,
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
		alertType: string;
		message: string;
		timestamp: string;
		details?: string | null;
		actionUrl?: string | null;
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

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview preview={`Security alert: ${alertType}`} />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Security alert" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">
					{alertType}
				</Heading>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					{#if userName}Hi {userName},{:else}Hi there,{/if}
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">
					{message}
				</Text>
				{#if details}
					<Section class="mt-4 border border-gray-800 bg-gray-950 p-4">
						<Text class="m-0 text-sm leading-5 text-gray-300">{details}</Text>
					</Section>
				{/if}
				{#if actionUrl}
					<Section class="mt-6">
						<Text class="m-0">
							<a
								href={actionUrl}
								class="inline-block [border-radius:0] border border-red-500 bg-red-500 px-6 py-3.5 font-semibold text-white no-underline"
							>
								Review activity
							</a>
						</Text>
					</Section>
				{/if}
				<Hr class="my-8 border-gray-800" />
				<Text class="text-sm leading-5 text-gray-500">
					This alert was triggered at {timestamp}. If you did not initiate this activity, please
					contact support@fyrastack.com and secure your account immediately.
				</Text>
			</Section>
		</Container>
	</Body>
</Html>
