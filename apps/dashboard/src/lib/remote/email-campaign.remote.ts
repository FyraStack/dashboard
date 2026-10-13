import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, eq, lt, or } from 'drizzle-orm';
import AdminUserDeletionCodeEmail from '#lib/emails/admin-user-deletion-code.svelte';
import BillingNoticeEmail from '#lib/emails/billing-notice.svelte';
import BillingReminderEmail from '#lib/emails/billing-reminder.svelte';
import {
	applyPlaceholders,
	CAMPAIGN_BATCH_SIZE,
	type CampaignTemplate,
	campaignTemplates,
	fieldToken
} from '#lib/emails/campaign-registry.js';
import EmptyEmail from '#lib/emails/empty.svelte';
import OrganizationInvitationEmail from '#lib/emails/organization-invitation.svelte';
import PasswordChangeCodeEmail from '#lib/emails/password-change-code.svelte';
import ResetPasswordEmail from '#lib/emails/reset-password.svelte';
import SecurityAlertEmail from '#lib/emails/security-alert.svelte';
import ServiceDisruptionEmail from '#lib/emails/service-disruption.svelte';
import VerifyEmailEmail from '#lib/emails/verify-email.svelte';
import { requireAdmin } from '#lib/server/auth-context.js';
import { type Database, initDrizzle } from '#lib/server/db/index.js';
import { emailCampaignRecipients, emailCampaigns } from '#lib/server/db/schema.js';
import { emailToPlainText, renderEmail, sendEmail } from '#lib/server/email.js';
import { command, getRequestEvent } from '$app/server';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STALE_CLAIM_MS = 10 * 60 * 1000;

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
	if (!event?.locals.user) {
		error(401, 'Authentication required');
	}

	const db = initDrizzle();
	await requireAdmin(db, event.locals.user.id);

	return { db, userId: event.locals.user.id };
}

function resolveTemplate(key: string) {
	const meta = campaignTemplates.find((template) => template.key === key);
	const component = templateComponents[key];
	if (!(meta && component)) {
		error(400, 'Unknown email template');
	}
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
			if (field.required) {
				throw new Error(`Missing value for ${field.label}`);
			}
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
		if (value !== '') {
			props[field.name] = value;
		} else if (field.required) {
			props[field.name] = field.placeholder;
		}
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

const createCampaignParams = type({
	template: 'string',
	subject: 'string',
	fields: csvRow
});

export const createEmailCampaign = command(createCampaignParams, async (params) => {
	const { db, userId } = await requireCurrentAdmin();
	const { meta } = resolveTemplate(params.template);
	if (params.subject.trim() === '') {
		error(400, 'Enter a subject');
	}

	const fields: Record<string, string> = {};
	for (const field of meta.fields) {
		fields[field.name] = params.fields[field.name] ?? '';
	}

	const [campaign] = await db
		.insert(emailCampaigns)
		.values({
			template: meta.key,
			subject: params.subject,
			fields,
			createdBy: userId,
			createdAt: Date.now()
		})
		.returning({ id: emailCampaigns.id });

	return { campaignId: campaign.id };
});

const sendParams = type({
	campaignId: 'string',
	rows: csvRow.array(),
	emailColumn: 'string'
});

type RecipientClaim = 'claimed' | 'sent' | 'in-progress';

async function claimRecipient(
	db: Database,
	campaignId: string,
	email: string
): Promise<RecipientClaim> {
	const now = Date.now();
	const [claimed] = await db
		.insert(emailCampaignRecipients)
		.values({ campaignId, email, status: 'pending', claimedAt: now })
		.onConflictDoUpdate({
			target: [emailCampaignRecipients.campaignId, emailCampaignRecipients.email],
			set: { status: 'pending', claimedAt: now, error: null },
			setWhere: or(
				eq(emailCampaignRecipients.status, 'failed'),
				and(
					eq(emailCampaignRecipients.status, 'pending'),
					lt(emailCampaignRecipients.claimedAt, now - STALE_CLAIM_MS)
				)
			)
		})
		.returning({ email: emailCampaignRecipients.email });
	if (claimed) {
		return 'claimed';
	}

	const [existing] = await db
		.select({ status: emailCampaignRecipients.status })
		.from(emailCampaignRecipients)
		.where(
			and(
				eq(emailCampaignRecipients.campaignId, campaignId),
				eq(emailCampaignRecipients.email, email)
			)
		)
		.limit(1);
	return existing?.status === 'sent' ? 'sent' : 'in-progress';
}

function settleRecipient(
	db: Database,
	campaignId: string,
	email: string,
	outcome: { status: 'sent' } | { status: 'failed'; error: string }
) {
	return db
		.update(emailCampaignRecipients)
		.set(
			outcome.status === 'sent'
				? { status: 'sent', sentAt: Date.now(), error: null }
				: { status: 'failed', error: outcome.error }
		)
		.where(
			and(
				eq(emailCampaignRecipients.campaignId, campaignId),
				eq(emailCampaignRecipients.email, email),
				eq(emailCampaignRecipients.status, 'pending')
			)
		);
}

type Campaign = typeof emailCampaigns.$inferSelect;

type RecipientOutcome =
	| { status: 'sent' }
	| { status: 'skipped' }
	| { status: 'failed'; reason: string };

async function sendToRecipient(
	db: Database,
	campaign: Campaign,
	template: ReturnType<typeof resolveTemplate>,
	row: Record<string, string>,
	to: string
): Promise<RecipientOutcome> {
	const email = to.toLowerCase();
	let claimed = false;
	try {
		if (!EMAIL_PATTERN.test(to)) {
			throw new Error('Invalid email address');
		}
		const subject = applyPlaceholders(campaign.subject, row).trim();
		if (subject === '') {
			throw new Error('Subject is empty for this recipient');
		}
		const html = await renderCampaignHtml(template.meta, template.component, campaign.fields, row);
		const text = await emailToPlainText(html);

		const claim = await claimRecipient(db, campaign.id, email);
		if (claim === 'sent') {
			return { status: 'skipped' };
		}
		if (claim === 'in-progress') {
			throw new Error('Already being sent by another request');
		}
		claimed = true;

		await sendEmail({ subject, to, html, text });
		await settleRecipient(db, campaign.id, email, { status: 'sent' });
		return { status: 'sent' };
	} catch (err) {
		const reason = err instanceof Error ? err.message : 'Send failed';
		if (claimed) {
			await settleRecipient(db, campaign.id, email, { status: 'failed', error: reason });
		}
		return { status: 'failed', reason };
	}
}

export const sendCampaignEmails = command(sendParams, async (params) => {
	const { db } = await requireCurrentAdmin();
	if (params.rows.length === 0) {
		error(400, 'No recipients provided');
	}
	if (params.rows.length > CAMPAIGN_BATCH_SIZE) {
		error(400, `Send at most ${CAMPAIGN_BATCH_SIZE} recipients per batch`);
	}

	const [campaign] = await db
		.select()
		.from(emailCampaigns)
		.where(eq(emailCampaigns.id, params.campaignId))
		.limit(1);
	if (!campaign) {
		error(404, 'Campaign not found');
	}
	const template = resolveTemplate(campaign.template);

	let sent = 0;
	let skipped = 0;
	const failures: { recipient: string; reason: string }[] = [];

	for (const row of params.rows) {
		const to = (row[params.emailColumn] ?? '').trim();
		// biome-ignore lint/performance/noAwaitInLoops: campaign sends go out one at a time to stay under the email provider's rate limit
		const outcome = await sendToRecipient(db, campaign, template, row, to);
		if (outcome.status === 'sent') {
			sent += 1;
		} else if (outcome.status === 'skipped') {
			skipped += 1;
		} else {
			failures.push({ recipient: to === '' ? '(missing email)' : to, reason: outcome.reason });
		}
	}

	return { sent, skipped, failures };
});
