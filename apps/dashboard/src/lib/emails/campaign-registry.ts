export const CAMPAIGN_BATCH_SIZE = 25;

export type CampaignField = {
	name: string;
	label: string;
	inline: boolean;
	required: boolean;
	placeholder: string;
	defaultValue?: string;
	options?: { value: string; label: string }[];
};

export type CampaignTemplate = {
	key: string;
	label: string;
	description: string;
	defaultSubject: string;
	fields: CampaignField[];
};

const userNameField: CampaignField = {
	name: 'userName',
	label: 'Recipient name',
	inline: true,
	required: false,
	placeholder: '{{name}}',
	defaultValue: '{{name}}'
};

export const campaignTemplates: CampaignTemplate[] = [
	{
		key: 'empty',
		label: 'Empty',
		description: 'Blank template: just your text on the standard email shell.',
		defaultSubject: '',
		fields: [
			{
				name: 'label',
				label: 'Header tag',
				inline: true,
				required: false,
				placeholder: 'Announcement',
				defaultValue: 'Announcement'
			},
			{
				name: 'preview',
				label: 'Preview text',
				inline: false,
				required: false,
				placeholder: 'Shown in inbox previews'
			},
			{
				name: 'body',
				label: 'Body',
				inline: true,
				required: true,
				placeholder: 'Write your message here',
				defaultValue: 'Hi {{name}},\n\nWrite your message here. Blank lines start new paragraphs.'
			}
		]
	},
	{
		key: 'service-disruption',
		label: 'Service disruption',
		description: 'Incident notice with a status banner, affected services, and status page link.',
		defaultSubject: 'Service disruption: {{incident}}',
		fields: [
			userNameField,
			{
				name: 'heading',
				label: 'Incident title',
				inline: true,
				required: true,
				placeholder: 'Incident title',
				defaultValue: 'Degraded VM performance in our datacenter'
			},
			{
				name: 'preview',
				label: 'Preview text',
				inline: false,
				required: true,
				placeholder: 'Shown in inbox previews',
				defaultValue: 'We are investigating a service disruption'
			},
			{
				name: 'severity',
				label: 'Severity',
				inline: false,
				required: true,
				placeholder: 'warning',
				defaultValue: 'warning',
				options: [
					{ value: 'critical', label: 'Critical' },
					{ value: 'warning', label: 'Warning' },
					{ value: 'info', label: 'Info' },
					{ value: 'resolved', label: 'Resolved' }
				]
			},
			{
				name: 'status',
				label: 'Status',
				inline: true,
				required: true,
				placeholder: 'Investigating / Identified / Monitoring / Resolved',
				defaultValue: 'Investigating'
			},
			{
				name: 'affectedServices',
				label: 'Affected services',
				inline: true,
				required: false,
				placeholder: 'Affected services',
				defaultValue: 'Virtual machines, volumes'
			},
			{
				name: 'timestamp',
				label: 'Timestamp',
				inline: true,
				required: false,
				placeholder: '2026-07-17 12:00 UTC'
			},
			{
				name: 'body',
				label: 'Body',
				inline: true,
				required: true,
				placeholder: 'What happened, impact, and next update',
				defaultValue:
					'We are investigating an issue affecting some services. Your data is safe, and we will follow up here as soon as we know more.'
			},
			{
				name: 'statusUrl',
				label: 'Status page URL',
				inline: false,
				required: false,
				placeholder: 'https://status.fyrastack.com'
			}
		]
	},
	{
		key: 'billing-notice',
		label: 'Billing notice',
		description: 'General notice with a heading, body text, and an action button.',
		defaultSubject: 'A notice about your Stack account',
		fields: [
			userNameField,
			{
				name: 'heading',
				label: 'Heading',
				inline: true,
				required: true,
				placeholder: 'Heading',
				defaultValue: 'A notice about your account'
			},
			{
				name: 'preview',
				label: 'Preview text',
				inline: false,
				required: true,
				placeholder: 'Shown in inbox previews',
				defaultValue: 'A notice about your Stack account'
			},
			{
				name: 'body',
				label: 'Body',
				inline: true,
				required: true,
				placeholder: 'Body',
				defaultValue: 'We wanted to let you know about an update to your account.'
			},
			{
				name: 'actionUrl',
				label: 'Button URL',
				inline: false,
				required: true,
				placeholder: 'https://stack.wtf/billing',
				defaultValue: 'https://stack.wtf/billing'
			},
			{
				name: 'actionLabel',
				label: 'Button label',
				inline: true,
				required: true,
				placeholder: 'Button label',
				defaultValue: 'View billing'
			}
		]
	},
	{
		key: 'security-alert',
		label: 'Security alert',
		description: 'Alert with a message, timestamp, optional details, and optional action link.',
		defaultSubject: 'Security alert: {{alert}}',
		fields: [
			userNameField,
			{
				name: 'alertType',
				label: 'Alert type',
				inline: true,
				required: true,
				placeholder: 'Alert type',
				defaultValue: 'New sign-in detected'
			},
			{
				name: 'message',
				label: 'Message',
				inline: true,
				required: true,
				placeholder: 'Message',
				defaultValue: 'We noticed a new sign-in to your account.'
			},
			{
				name: 'timestamp',
				label: 'Timestamp',
				inline: true,
				required: true,
				placeholder: 'Timestamp',
				defaultValue: '2026-07-01 12:00 UTC'
			},
			{
				name: 'details',
				label: 'Details',
				inline: true,
				required: false,
				placeholder: 'Details'
			},
			{
				name: 'actionUrl',
				label: 'Action URL',
				inline: false,
				required: false,
				placeholder: 'https://stack.wtf/settings/security'
			}
		]
	},
	{
		key: 'billing-reminder',
		label: 'Billing reminder',
		description: 'Payment reminder with an amount, due date, and invoice link.',
		defaultSubject: 'Stack invoice ready: {{amount}}',
		fields: [
			userNameField,
			{
				name: 'amount',
				label: 'Amount',
				inline: true,
				required: true,
				placeholder: 'Amount',
				defaultValue: '{{amount}}'
			},
			{
				name: 'dueDate',
				label: 'Due date',
				inline: true,
				required: true,
				placeholder: 'Due date',
				defaultValue: 'July 15, 2026'
			},
			{
				name: 'invoiceUrl',
				label: 'Invoice URL',
				inline: false,
				required: true,
				placeholder: 'https://stack.wtf/billing',
				defaultValue: 'https://stack.wtf/billing'
			},
			{
				name: 'planName',
				label: 'Plan name',
				inline: true,
				required: false,
				placeholder: 'Plan name'
			}
		]
	},
	{
		key: 'organization-invitation',
		label: 'Organization invitation',
		description: 'Invitation to join an organization with an accept link.',
		defaultSubject: "You're invited to join {{organization}} on Stack",
		fields: [
			{
				name: 'organizationName',
				label: 'Organization name',
				inline: true,
				required: true,
				placeholder: 'Organization name',
				defaultValue: '{{organization}}'
			},
			{
				name: 'invitationUrl',
				label: 'Invitation URL',
				inline: false,
				required: true,
				placeholder: 'https://stack.wtf/invite/{{token}}',
				defaultValue: 'https://stack.wtf/invite/{{token}}'
			}
		]
	},
	{
		key: 'verify-email',
		label: 'Verify email',
		description: 'Email verification with a confirmation button.',
		defaultSubject: 'Verify your Stack email',
		fields: [
			userNameField,
			{
				name: 'verificationUrl',
				label: 'Verification URL',
				inline: false,
				required: true,
				placeholder: 'https://stack.wtf/verify/{{token}}',
				defaultValue: 'https://stack.wtf/verify/{{token}}'
			}
		]
	},
	{
		key: 'reset-password',
		label: 'Reset password',
		description: 'Password reset with a reset button.',
		defaultSubject: 'Reset your Stack password',
		fields: [
			userNameField,
			{
				name: 'resetUrl',
				label: 'Reset URL',
				inline: false,
				required: true,
				placeholder: 'https://stack.wtf/reset/{{token}}',
				defaultValue: 'https://stack.wtf/reset/{{token}}'
			}
		]
	},
	{
		key: 'password-change-code',
		label: 'Password change code',
		description: 'One-time code confirming a password change.',
		defaultSubject: 'Confirm your Stack password change',
		fields: [
			userNameField,
			{
				name: 'code',
				label: 'Code',
				inline: true,
				required: true,
				placeholder: 'Code',
				defaultValue: '{{code}}'
			},
			{
				name: 'expiresInMinutes',
				label: 'Expires in (minutes)',
				inline: true,
				required: true,
				placeholder: '10',
				defaultValue: '10'
			}
		]
	},
	{
		key: 'admin-user-deletion-code',
		label: 'User deletion code',
		description: 'One-time code confirming an account deletion.',
		defaultSubject: 'Confirm Stack user deletion',
		fields: [
			userNameField,
			{
				name: 'targetEmail',
				label: 'Target email',
				inline: true,
				required: true,
				placeholder: 'Target email',
				defaultValue: '{{email}}'
			},
			{
				name: 'code',
				label: 'Code',
				inline: true,
				required: true,
				placeholder: 'Code',
				defaultValue: '{{code}}'
			},
			{
				name: 'expiresInMinutes',
				label: 'Expires in (minutes)',
				inline: true,
				required: true,
				placeholder: '10',
				defaultValue: '10'
			}
		]
	}
];

export function fieldToken(name: string): string {
	return `[[FIELD:${name}]]`;
}

const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function applyPlaceholders(template: string, row: Record<string, string>): string {
	return template.replace(placeholderPattern, (_, name: string) => row[name.trim()] ?? '');
}

export function extractPlaceholders(template: string): string[] {
	return [...template.matchAll(placeholderPattern)].map((match) => match[1].trim());
}
