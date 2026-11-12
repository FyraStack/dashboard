import type { Renderer } from '@better-svelte-email/server';
import appStyles from '#lib/emails/theme.css?raw';
import { getRuntimeEnv } from '#lib/server/env.js';
import { instrument } from '#lib/server/observability.js';

const emailServerModule = () => import('@better-svelte-email/server');

let emailRendererPromise: Promise<Renderer> | undefined;

function getEmailRenderer() {
	emailRendererPromise ??= emailServerModule().then(
		({ Renderer: EmailRenderer }) => new EmailRenderer({ customCSS: appStyles })
	);
	return emailRendererPromise;
}

export async function emailToPlainText(html: string) {
	const { toPlainText } = await emailServerModule();
	return toPlainText(html);
}

interface SendRenderedEmailParams {
	component: unknown;
	props?: Record<string, unknown>;
	subject: string;
	to: string;
}

interface CloudflareEmailResponse {
	errors?: { code?: number; message?: string }[];
	messages?: { code?: number; message?: string }[];
	result?: {
		delivered?: string[];
		permanent_bounces?: string[];
		queued?: string[];
	};
	success?: boolean;
}

type CloudflareAccountsResponse = CloudflareEmailResponse & {
	result?: { id: string; name?: string }[];
};

async function readCloudflareBody<T>(response: Response): Promise<T | string> {
	try {
		return (await response.json()) as T;
	} catch {
		return response.text();
	}
}

function describeCloudflareErrors(body: CloudflareEmailResponse | string) {
	if (typeof body === 'string') {
		return body;
	}
	return [...(body.errors ?? []), ...(body.messages ?? [])]
		.map((entry) => entry.message ?? entry.code)
		.filter(Boolean)
		.join(', ');
}

let cachedCloudflareAccountId: string | null = null;

async function getCloudflareAccountId(apiToken: string) {
	if (cachedCloudflareAccountId) {
		return cachedCloudflareAccountId;
	}

	const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=2', {
		headers: { Authorization: `Bearer ${apiToken}` }
	});

	const body = await readCloudflareBody<CloudflareAccountsResponse>(response);

	if (!response.ok) {
		const details = describeCloudflareErrors(body);

		throw new Error(
			`Unable to discover Cloudflare account ID (${response.status}${details ? `: ${details}` : ''}). Set CLOUDFLARE_ACCOUNT_ID explicitly.`
		);
	}

	if (typeof body === 'string') {
		throw new Error(
			'Unable to discover Cloudflare account ID. Set CLOUDFLARE_ACCOUNT_ID explicitly.'
		);
	}

	const accounts = body.result ?? [];
	if (accounts.length === 1) {
		cachedCloudflareAccountId = accounts[0].id;
		return cachedCloudflareAccountId;
	}

	throw new Error(
		accounts.length === 0
			? 'Cloudflare API token cannot access any accounts. Set CLOUDFLARE_ACCOUNT_ID explicitly.'
			: 'Cloudflare API token can access multiple accounts. Set CLOUDFLARE_ACCOUNT_ID explicitly.'
	);
}

async function sendCloudflareEmail({
	accountId,
	apiToken,
	fromAddress,
	fromName,
	replyTo,
	to,
	subject,
	html,
	text
}: {
	accountId: string;
	apiToken: string;
	fromAddress: string;
	fromName: string;
	replyTo: string;
	to: string;
	subject: string;
	html: string;
	text: string;
}) {
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: { address: fromAddress, name: fromName },
				to,
				reply_to: replyTo,
				subject,
				html,
				text
			})
		}
	);

	const body = await readCloudflareBody<CloudflareEmailResponse>(response);

	if (response.ok) {
		console.info('[Email sent with Cloudflare REST API]', {
			to,
			subject,
			response: body
		});
		return;
	}

	const details = describeCloudflareErrors(body);

	throw new Error(
		`Cloudflare Email REST send failed (${response.status}${details ? `: ${details}` : ''})`
	);
}

export async function renderEmail(component: unknown, props?: Record<string, unknown>) {
	const renderer = await getEmailRenderer();
	const html = await instrument('email.render', () => renderer.render(component, { props }));
	return { html, text: await emailToPlainText(html) };
}

interface SendEmailParams {
	html: string;
	subject: string;
	text: string;
	to: string;
}

export async function sendRenderedEmail({
	component,
	props,
	subject,
	to
}: SendRenderedEmailParams) {
	const { html, text } = await renderEmail(component, props);
	await sendEmail({ subject, to, html, text });
}

export async function sendEmail({ subject, to, html, text }: SendEmailParams) {
	const env = getRuntimeEnv();

	const fromAddress = env.EMAIL_FROM_ADDRESS;
	const fromName = env.EMAIL_FROM_NAME;
	const replyTo = env.EMAIL_REPLY_TO;

	const emailBinding = env.EMAIL;
	if (emailBinding) {
		await instrument(
			'email.send',
			() =>
				emailBinding.send({
					from: { name: fromName, email: fromAddress },
					to,
					subject,
					replyTo,
					html,
					text
				}),
			{ 'email.provider': 'binding' }
		);
		return;
	}

	const cloudflareApiToken = env.CLOUDFLARE_EMAIL_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
	if (cloudflareApiToken) {
		const accountId =
			env.CLOUDFLARE_ACCOUNT_ID ?? (await getCloudflareAccountId(cloudflareApiToken));

		await instrument(
			'email.send',
			() =>
				sendCloudflareEmail({
					accountId,
					apiToken: cloudflareApiToken,
					fromAddress,
					fromName,
					replyTo,
					to,
					subject,
					html,
					text
				}),
			{ 'email.provider': 'rest' }
		);
		return;
	}

	if (!import.meta.env.DEV) {
		throw new Error(
			'No email provider is configured. Configure the EMAIL binding or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN.'
		);
	}

	console.info(
		`[Email skipped: EMAIL binding is unavailable in Vite dev and REST fallback is not configured.]\nTo: ${to}\nSubject: ${subject}\n\n${text}`
	);
}
