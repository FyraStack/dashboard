<script lang="ts">
	import {
		Body,
		Column,
		Container,
		Head,
		Heading,
		Hr,
		Html,
		Img,
		Preview,
		Row,
		Section,
		Text
	} from '@better-svelte-email/components';
	import type { Snippet } from 'svelte';
	import { logoUrl } from '../brand.ts';

	interface Props {
		children: Snippet;
		fallbackUrl?: string | null;
		footer?: Snippet;
		heading?: string;
		label: string;
		lead?: Snippet;
		preview?: string | null;
		userName?: string | null;
	}

	let {
		children,
		fallbackUrl = null,
		footer,
		heading,
		label,
		lead,
		preview = null,
		userName
	}: Props = $props();
</script>

<Html>
	<Head />
	<Body class="bg-gray-950 font-sans">
		{#if preview}
			<Preview {preview} />
		{/if}
		<Container class="mx-auto my-8 max-w-xl [border-radius:0] border border-gray-800 bg-gray-900">
			<Section
				class="[border-radius:0] border-t-2 border-b border-red-500 border-b-gray-800 bg-gray-950 p-6"
			>
				<Row>
					<Column width="40" class="align-middle">
						<Img src={logoUrl} alt="" width="28" height="28" />
					</Column>
					<Column class="align-middle">
						<Text class="m-0 text-base font-semibold tracking-wide text-gray-50">Stack</Text>
						<Text class="m-0 mt-1 font-mono text-xs tracking-wide text-red-400 uppercase">
							{label}
						</Text>
					</Column>
				</Row>
			</Section>
			<Section class="p-8">
				{#if heading}
					<Heading as="h1" class="m-0 text-xl font-semibold text-gray-50">{heading}</Heading>
				{/if}
				{@render lead?.()}
				{#if userName !== undefined}
					<Text class="mt-4 text-sm leading-5 text-gray-400">
						{#if userName}
							Hi {userName},
						{:else}
							Hi there,
						{/if}
					</Text>
				{/if}
				{@render children()}
				{#if footer || fallbackUrl}
					<Hr class="my-8 border-gray-800" />
				{/if}
				{#if footer}
					<Text class="text-sm leading-5 text-gray-500">{@render footer()}</Text>
				{/if}
				{#if fallbackUrl}
					<Text class="{footer ? 'mt-3 ' : ''}text-sm leading-5 text-gray-500">
						If the button above doesn't work, copy and paste this URL into your browser:
					</Text>
					<Text class="mt-1 text-sm leading-5 break-all text-gray-500">
						<a href={fallbackUrl} class="break-all text-red-400 no-underline">{fallbackUrl}</a>
					</Text>
				{/if}
			</Section>
		</Container>
	</Body>
</Html>
