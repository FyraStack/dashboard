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
		amount: string;
		dueDate: string;
		invoiceUrl: string;
		planName?: string | null;
	}

	let { userName = null, amount, dueDate, invoiceUrl, planName = null }: Props = $props();
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		<Preview preview={`Your Stack invoice for ${amount} is ready`} />
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label="Billing" />
			<Section class="p-8">
				<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">Invoice ready</Heading>
				<Text class="mt-4 text-sm leading-5 text-gray-400">
					{#if userName}Hi {userName},{:else}Hi there,{/if}
				</Text>
				<Text class="mt-2 text-sm leading-5 text-gray-400">
					Your Stack invoice for <strong class="text-gray-50">{amount}</strong>
					{#if planName}({planName}){/if}
					is ready. Payment is due by {dueDate}.
				</Text>
				<Section class="mt-6">
					<Button
						href={invoiceUrl}
						pX={24}
						pY={14}
						class="[border-radius:0] border border-red-500 bg-red-500 font-semibold text-white"
					>
						View invoice
					</Button>
				</Section>
				<Hr class="my-8 border-gray-800" />
				<Text class="text-sm leading-5 text-gray-500">
					If the button above doesn't work, copy and paste this URL into your browser:
				</Text>
				<Text class="mt-1 text-sm leading-5 break-all text-gray-500">
					<a href={invoiceUrl} class="break-all text-red-400 no-underline">
						{invoiceUrl}
					</a>
				</Text>
			</Section>
		</Container>
	</Body>
</Html>
