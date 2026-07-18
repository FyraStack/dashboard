import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import AdminUserDeletionCodeEmail from '$lib/emails/admin-user-deletion-code.svelte';
import BillingNoticeEmail from '$lib/emails/billing-notice.svelte';
import BillingReminderEmail from '$lib/emails/billing-reminder.svelte';
import EmptyEmail from '$lib/emails/empty.svelte';
import OrganizationInvitationEmail from '$lib/emails/organization-invitation.svelte';
import PasswordChangeCodeEmail from '$lib/emails/password-change-code.svelte';
import ResetPasswordEmail from '$lib/emails/reset-password.svelte';
import SecurityAlertEmail from '$lib/emails/security-alert.svelte';
import ServiceDisruptionEmail from '$lib/emails/service-disruption.svelte';
import VerifyEmailEmail from '$lib/emails/verify-email.svelte';
import {
	applyPlaceholders,
	CAMPAIGN_BATCH_SIZE,
	campaignTemplates,
	fieldToken,
	type CampaignTemplate
} from '$lib/emails/campaign-registry';
import { requireAdmin } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import { emailToPlainText, renderEmail, sendEmail } from '$lib/server/email';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const templateComponents: Record<string, unknown> = {
	'admin-user-deletion-code': AdminUserDeletionCodeEmail,
	'billing-notice': BillingNoticeEmail,
	'billing-reminder': BillingReminderEmail,
	empty: EmptyEmail,
	'organization-invitation': OrganizationInvitationEmail,
	'password-change-code': PasswordChangeCodeEmail,
	'reset-password': ResetPasswordEmail,
	'security-alert': SecurityAlertEmail,
	'service-disruption': ServiceDisruptionEmail,
	'verify-email': VerifyEmailEmail
};

async function requireCurrentAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return { db, userId: event.locals.user.id };
}

function resolveTemplate(key: string) {
	const meta = campaignTemplates.find((template) => template.key === key);
	const component = templateComponents[key];
	if (!meta || !component) error(400, 'Unknown email template');
	return { meta, component };
}

async function renderCampaignHtml(
	meta: CampaignTemplate,
	component: unknown,
	fields: Record<string, string>,
	row: Record<string, string>
) {
	const props: Record<string, unknown> = {};
	const inlineValues: Record<string, string> = {};
	for (const field of meta.fields) {
		const value = applyPlaceholders(fields[field.name] ?? '', row).trim();
		if (value === '') {
			if (field.required) throw new Error(`Missing value for ${field.label}`);
			continue;
		}
		if (field.inline) {
			props[field.name] = fieldToken(field.name);
			inlineValues[field.name] = value;
		} else {
			props[field.name] = value;
		}
	}

	const { html } = await renderEmail(component, props);
	let output = html;
	for (const [name, value] of Object.entries(inlineValues)) {
		output = output.replaceAll(fieldToken(name), value.replaceAll('\n', '<br />'));
	}
	return output;
}

const csvRow = type({ '[string]': 'string' });

const editorParams = type({
	template: 'string',
	fields: csvRow
});

export const renderCampaignEditor = command(editorParams, async (params) => {
	await requireCurrentAdmin();
	const { meta, component } = resolveTemplate(params.template);

	const props: Record<string, unknown> = {};
	for (const field of meta.fields) {
		if (field.inline) {
			props[field.name] = fieldToken(field.name);
			continue;
		}
		const value = (params.fields[field.name] ?? '').trim();
		if (value !== '') props[field.name] = value;
		else if (field.required) props[field.name] = field.placeholder;
	}

	const { html } = await renderEmail(component, props);
	return { html };
});

const previewParams = type({
	template: 'string',
	subject: 'string',
	fields: csvRow,
	row: csvRow
});

export const previewCampaignEmail = command(previewParams, async (params) => {
	await requireCurrentAdmin();
	const { meta, component } = resolveTemplate(params.template);

	try {
		const subject = applyPlaceholders(params.subject, params.row).trim();
		const html = await renderCampaignHtml(meta, component, params.fields, params.row);
		return { subject, html };
	} catch (err) {
		error(400, err instanceof Error ? err.message : 'Failed to render preview');
	}
});

const sendParams = type({
	template: 'string',
	subject: 'string',
	fields: csvRow,
	rows: csvRow.array(),
	emailColumn: 'string'
});

export const sendCampaignEmails = command(sendParams, async (params) => {
	await requireCurrentAdmin();
	const { meta, component } = resolveTemplate(params.template);
	if (params.rows.length === 0) error(400, 'No recipients provided');
	if (params.rows.length > CAMPAIGN_BATCH_SIZE) {
		error(400, `Send at most ${CAMPAIGN_BATCH_SIZE} recipients per batch`);
	}

	let sent = 0;
	const failures: { recipient: string; reason: string }[] = [];

	for (const row of params.rows) {
		const to = (row[params.emailColumn] ?? '').trim();
		try {
			if (!EMAIL_PATTERN.test(to)) throw new Error('Invalid email address');
			const subject = applyPlaceholders(params.subject, row).trim();
			if (subject === '') throw new Error('Subject is empty for this recipient');
			const html = await renderCampaignHtml(meta, component, params.fields, row);
			const text = await emailToPlainText(html);
			await sendEmail({ subject, to, html, text });
			sent += 1;
		} catch (err) {
			failures.push({
				recipient: to === '' ? '(missing email)' : to,
				reason: err instanceof Error ? err.message : 'Send failed'
			});
		}
	}

	return { sent, failures };
});
