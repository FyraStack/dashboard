<script lang="ts">
	import { Column, Img, Row, Section, Text } from '@better-svelte-email/components';

	interface Props {
		label: string;
	}

	let { label }: Props = $props();
</script>

<Section
	class="[border-radius:0] border-t-2 border-b border-red-500 border-b-gray-800 bg-gray-950 p-6"
>
	<Row>
		<Column width="40" class="align-middle">
			<Img src="https://fyrastack.com/stack-email-logo.png" alt="" width="28" height="28" />
		</Column>
		<Column class="align-middle">
			<Text class="m-0 text-base font-semibold tracking-wide text-gray-50">Stack</Text>
			<Text class="m-0 mt-1 font-mono text-xs tracking-wide text-red-400 uppercase">{label}</Text>
		</Column>
	</Row>
</Section>
