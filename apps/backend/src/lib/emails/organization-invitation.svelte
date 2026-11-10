<script lang="ts">
	import { Text } from '@better-svelte-email/components';
	import ActionButton from './components/action-button.svelte';
	import EmailLayout from './components/email-layout.svelte';

	interface Props {
		invitationUrl: string;
		organizationName: string;
	}

	let { organizationName, invitationUrl }: Props = $props();
</script>

<EmailLayout
	label="Organization invitation"
	heading={`Join ${organizationName}`}
	preview={`You're invited to join ${organizationName} on Stack`}
	fallbackUrl={invitationUrl}
>
	<Text class="mt-4 text-sm leading-5 text-gray-400">
		You've been invited to join the {organizationName} project on Stack.
	</Text>
	<Text class="mt-2 text-sm leading-5 text-gray-400">
		Accept the invitation to collaborate with your team and access the project dashboard.
	</Text>
	<ActionButton href={invitationUrl} label="Accept invitation" />
</EmailLayout>
