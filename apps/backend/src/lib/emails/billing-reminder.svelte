<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		amount: string;
		dueDate: string;
		invoiceUrl: string;
		planName?: string | null;
		userName?: string | null;
	}

	let { userName = null, amount, dueDate, invoiceUrl, planName = null }: Props = $props();
</script>

<EmailLayout
	label="Billing"
	heading="Invoice ready"
	preview={`Your Stack invoice for ${amount} is ready`}
	{userName}
	fallbackUrl={invoiceUrl}
>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Your Stack invoice for <strong class="text-gray-50">{amount}</strong>
		{#if planName}
			({planName})
		{/if}
		is ready. Payment is due by {dueDate}.
	</Text>
	<ActionButton href={invoiceUrl} label="View invoice" />
</EmailLayout>
