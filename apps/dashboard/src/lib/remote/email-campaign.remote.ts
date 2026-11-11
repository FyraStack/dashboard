import { type } from 'arktype';
import { idempotencyKeySchema } from '#lib/remote/schemas.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listCampaignTemplates = query(() => backend((me) => me.admin().emails().templates()));

const csvRow = type({ '[string]': 'string' });

const editorParams = type({
	template: 'string',
	fields: csvRow
});

export const renderCampaignEditor = command(editorParams, (input) =>
	backend((me) => me.admin().emails().renderEditor(input))
);

const previewParams = type({
	template: 'string',
	subject: 'string',
	fields: csvRow,
	row: csvRow
});

export const previewCampaignEmail = command(previewParams, (input) =>
	backend((me) => me.admin().emails().preview(input))
);

const sendParams = type({
	template: 'string',
	subject: 'string',
	fields: csvRow,
	rows: csvRow.array(),
	emailColumn: 'string',
	idempotencyKey: idempotencyKeySchema
});

export const sendCampaignEmails = command(sendParams, (input) =>
	backend((me) => me.admin().emails().send(input))
);
