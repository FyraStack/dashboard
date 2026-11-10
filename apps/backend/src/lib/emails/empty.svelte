<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import EmailLayout from './components/email-layout.svelte';

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

<EmailLayout label={label ?? 'Message'} {preview}>
	{#each paragraphs as paragraph, index (index)}
		<Text class="m-0 {index > 0 ? 'mt-4' : ''} text-sm leading-5 text-gray-400">
			{paragraph}
		</Text>
	{/each}
</EmailLayout>
