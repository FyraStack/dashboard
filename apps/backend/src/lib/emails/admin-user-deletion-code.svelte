<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import CodeBox from './components/code-box.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		code: string;
		expiresInMinutes: number;
		targetEmail: string;
		userName?: string | null;
	}

	let { userName = null, targetEmail, code, expiresInMinutes }: Props = $props();
</script>

<EmailLayout
	label="Admin confirmation"
	heading="Confirm user deletion"
	preview="Confirm Stack user deletion"
	{userName}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Enter this code in Stack to confirm deleting {targetEmail}.
	</Text>
	<CodeBox {code} />
	{#snippet footer()}
		This code expires in {expiresInMinutes} minutes. If you did not request this deletion, contact
		{supportEmail}
		and secure your account immediately.
	{/snippet}
</EmailLayout>
