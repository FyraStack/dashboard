<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import { supportEmail } from './brand.ts';
	import CodeBox from './components/code-box.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		code: string;
		expiresInMinutes: number;
		userName?: string | null;
	}

	let { userName = null, code, expiresInMinutes }: Props = $props();
</script>

<EmailLayout
	label="Two-factor reset"
	heading="Reset two-factor authentication"
	preview="Reset your Stack two-factor authentication"
	{userName}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Enter this code in Stack to reset the authenticator app on your account.
	</Text>
	<CodeBox {code} />
	{#snippet footer()}
		This code expires in {expiresInMinutes} minutes. If you did not request this change, contact
		{supportEmail}
		and secure your account immediately.
	{/snippet}
</EmailLayout>
