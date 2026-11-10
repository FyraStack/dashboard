<script lang="ts">
	import { Section, Text } from '@better-svelte-email/components';

	let { code }: { code: string } = $props();
</script>

<Section class="mt-6 border border-gray-800 bg-gray-950 p-4">
	<Text class="m-0 font-mono text-2xl font-semibold tracking-widest text-gray-50">{code}</Text>
</Section>
