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
		organizationName: string;
		invitationUrl: string;
	}

	let { organizationName, invitationUrl }: Props = $props();
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview preview={`You're invited to join ${organizationName} on Stack`} />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Organization invitation" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">
					Join {organizationName}
				</Heading>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					You've been invited to join the {organizationName} project on Stack.
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">
					Accept the invitation to collaborate with your team and access the project dashboard.
				</Text>
				<Section class="mt-6">
					<Button
						href={invitationUrl}
						pX={24}
						pY={14}
						class="[border-radius:0] border border-red-500 bg-red-500 font-semibold text-white"
					>
						Accept invitation
					</Button>
				</Section>
				<Hr class="my-8 border-gray-800" />
				<Text class="text-sm leading-5 text-gray-500">
					If the button above doesn't work, copy and paste this URL into your browser:
				</Text>
				<Text class="mt-1 text-sm leading-5 break-all text-gray-500">
					<a href={invitationUrl} class="break-all text-red-400 no-underline">
						{invitationUrl}
					</a>
				</Text>
			</Section>
		</Container>
	</Body>
</Html>
