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
		confirmationUrl: string;
		newEmail: string;
		userName?: string | null;
	}

	let { userName = null, newEmail, confirmationUrl }: Props = $props();
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview preview="Confirm your Stack email change" />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Email change" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50"
					>Confirm your email change</Heading
				>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					{#if userName}
						Hi {userName},
					{:else}
						Hi there,
					{/if}
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">
					Someone asked to change the email on your Stack account to {newEmail}. Confirm below and
					we'll send a verification link to the new address.
				</Text>
				<Section class="mt-6">
					<Button
						href={confirmationUrl}
						pX={24}
						pY={14}
						class="[border-radius:0] border border-red-500 bg-red-500 font-semibold text-white"
					>
						Confirm email change
					</Button>
				</Section>
				<Hr class="my-8 border-gray-800" />
				<Text class="text-sm leading-5 text-gray-500">
					If you did not request this change, ignore this email, change your password, and contact
					support@fyrastack.com.
				</Text>
				<Text class="mt-3 text-sm leading-5 text-gray-500">
					If the button above doesn't work, copy and paste this URL into your browser:
				</Text>
				<Text class="mt-1 text-sm leading-5 break-all text-gray-500">
					<a href={confirmationUrl} class="break-all text-red-400 no-underline">
						{confirmationUrl}
					</a>
				</Text>
			</Section>
		</Container>
	</Body>
</Html>
