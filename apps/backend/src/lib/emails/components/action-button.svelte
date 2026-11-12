<script lang="ts">
	import { Button, Section } from '@better-svelte-email/components';

	let { href, label }: { href: string; label: string } = $props();
</script>

<Section class="mt-6">
	<Button
		{href}
		pX={24}
		pY={14}
		class="[border-radius:0] border border-red-500 bg-red-500 font-semibold text-white"
	>
		{label}
	</Button>
</Section>
