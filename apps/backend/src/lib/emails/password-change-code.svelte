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
	label="Password change"
	heading="Confirm password change"
	preview="Confirm your Stack password change"
	{userName}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Enter this code in Stack to finish changing your password.
	</Text>
	<CodeBox {code} />
	{#snippet footer()}
		This code expires in {expiresInMinutes} minutes. If you did not request this password change,
		contact {supportEmail}.
	{/snippet}
</EmailLayout>
