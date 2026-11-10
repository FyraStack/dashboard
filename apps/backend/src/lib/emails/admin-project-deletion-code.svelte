<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import CodeBox from './components/code-box.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		code: string;
		expiresInMinutes: number;
		projectName: string;
		userName?: string | null;
	}

	let { userName = null, projectName, code, expiresInMinutes }: Props = $props();
</script>

<EmailLayout
	label="Admin confirmation"
	heading="Confirm project deletion"
	preview="Confirm Stack project deletion"
	{userName}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Enter this code in Stack to confirm deleting the project "{projectName}" and all of its servers
		and volumes.
	</Text>
	<CodeBox {code} />
	{#snippet footer()}
		This code expires in {expiresInMinutes} minutes. If you did not request this deletion, contact
		{supportEmail}
		and secure your account immediately.
	{/snippet}
</EmailLayout>
