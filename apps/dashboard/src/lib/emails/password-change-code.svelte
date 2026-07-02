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
		code: string;
		expiresInMinutes: number;
	}

	let { userName = null, code, expiresInMinutes }: Props = $props();
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview preview="Confirm your Stack password change" />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Password change" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">
					Confirm password change
				</Heading>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					{#if userName}Hi {userName},{:else}Hi there,{/if}
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">
					Enter this code in Stack to finish changing your password.
				</Text>
				<Section class="mt-6 border border-gray-800 bg-gray-950 p-4">
					<Text class="m-0 font-mono text-2xl font-semibold tracking-widest text-gray-50">
						{code}
					</Text>
				</Section>
				<Hr class="my-8 border-gray-800" />
				<Text class="text-sm leading-5 text-gray-500">
					This code expires in {expiresInMinutes} minutes. If you did not request this password change,
					contact support@fyrastack.com.
				</Text>
			</Section>
		</Container>
	</Body>
</Html>
