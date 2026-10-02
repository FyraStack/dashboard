<script lang="ts">
	import {
		Body,
		Container,
		Head,
		Html,
		Preview,
		Section,
		Text
	} from '@better-svelte-email/components';
	import EmailHeader from './email-header.svelte';

	interface Props {
		body: string;
		label?: string | null;
		preview?: string | null;
	}

	let { label = null, preview = null, body }: Props = $props();

	const paragraphs = $derived(
		body
			.split(/\r?\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph !== '')
	);
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		{#if preview}
			<Preview {preview} />
		{/if}
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<EmailHeader label={label ?? 'Message'} />
			<Section class="p-8">
				{#each paragraphs as paragraph, index (index)}
					<Text class="m-0 {index > 0 ? 'mt-4' : ''} text-sm leading-5 text-gray-400">
						{paragraph}
					</Text>
				{/each}
			</Section>
		</Container>
	</Body>
</Html>
