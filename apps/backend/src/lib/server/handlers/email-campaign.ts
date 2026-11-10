import { applyPlaceholders, fieldToken } from 'stack-shared/email-campaign';
import {
	CAMPAIGN_BATCH_SIZE,
	type CampaignTemplate,
	type CampaignTemplateEntry,
	campaignTemplates
} from '#lib/emails/campaign-registry.js';
import { requireAdminUser } from '#lib/server/auth-context.js';
import { emailToPlainText, renderEmail, sendEmail } from '#lib/server/email.js';
import { errorMessage } from '#lib/server/errors.js';
import { error } from '#lib/server/http.js';
import { withIdempotency } from '#lib/server/idempotency.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CampaignRow = Record<string, string>;

export interface RenderCampaignEditorInput {
	fields: CampaignRow;
	template: string;
}

export interface PreviewCampaignEmailInput {
	fields: CampaignRow;
	row: CampaignRow;
	subject: string;
	template: string;
}

export interface SendCampaignEmailsInput {
	emailColumn: string;
	fields: CampaignRow;
	idempotencyKey: string;
	rows: CampaignRow[];
	subject: string;
	template: string;
}

export interface CampaignTemplateCatalog {
	batchSize: number;
	templates: CampaignTemplate[];
}

function resolveTemplate(key: string) {
	const template = campaignTemplates.find((entry) => entry.key === key);
	if (!template) {
		error(400, 'Unknown email template');
	}
	return template;
}

async function renderCampaignHtml(
	{ component, fields: templateFields }: CampaignTemplateEntry,
	fields: Record<string, string>,
	row: Record<string, string>
) {
	const props: Record<string, unknown> = {};
	const inlineValues: Record<string, string> = {};
	for (const field of templateFields) {
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

export async function listCampaignTemplates(): Promise<CampaignTemplateCatalog> {
	await requireAdminUser();
	return {
		batchSize: CAMPAIGN_BATCH_SIZE,
		templates: campaignTemplates.map(({ component: _component, ...template }) => template)
	};
}

export async function renderCampaignEditor(params: RenderCampaignEditorInput) {
	await requireAdminUser();
	const { component, fields } = resolveTemplate(params.template);

	const props: Record<string, unknown> = {};
	for (const field of fields) {
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
}

export async function previewCampaignEmail(params: PreviewCampaignEmailInput) {
	await requireAdminUser();
	const template = resolveTemplate(params.template);

	try {
		const subject = applyPlaceholders(params.subject, params.row).trim();
		const html = await renderCampaignHtml(template, params.fields, params.row);
		return { subject, html };
	} catch (err) {
		error(400, errorMessage(err));
	}
}

export async function sendCampaignEmails(params: SendCampaignEmailsInput) {
	const { db, user } = await requireAdminUser();
	const template = resolveTemplate(params.template);
	if (params.rows.length === 0) {
		error(400, 'No recipients provided');
	}
	if (params.rows.length > CAMPAIGN_BATCH_SIZE) {
		error(400, `Send at most ${CAMPAIGN_BATCH_SIZE} recipients per batch`);
	}

	return withIdempotency(
		db,
		{
			key: params.idempotencyKey,
			operation: 'admin.sendCampaignEmails',
			args: {
				template: params.template,
				subject: params.subject,
				fields: JSON.stringify(params.fields),
				rows: JSON.stringify(params.rows),
				emailColumn: params.emailColumn,
				userId: user.id
			}
		},
		async () => {
			let sent = 0;
			const failures: { recipient: string; reason: string }[] = [];

			for (const row of params.rows) {
				const to = (row[params.emailColumn] ?? '').trim();
				try {
					if (!EMAIL_PATTERN.test(to)) {
						throw new Error('Invalid email address');
					}
					const subject = applyPlaceholders(params.subject, row).trim();
					if (subject === '') {
						throw new Error('Subject is empty for this recipient');
					}
					// biome-ignore lint/performance/noAwaitInLoops: campaign sends go out one at a time to stay under the email provider's rate limit
					const html = await renderCampaignHtml(template, params.fields, row);
					const text = await emailToPlainText(html);
					await sendEmail({ subject, to, html, text });
					sent += 1;
				} catch (err) {
					failures.push({
						recipient: to === '' ? '(missing email)' : to,
						reason: errorMessage(err)
					});
				}
			}

			return { sent, failures };
		}
	);
}
