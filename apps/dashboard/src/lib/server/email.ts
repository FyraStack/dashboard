import { dev } from '$app/environment';
import appStyles from '../../routes/layout.css?raw';
import { getRuntimeEnv } from '$lib/server/env';
import { instrument } from '$lib/server/observability';

type EmailRenderer = {
	render(component: unknown, options: { props?: Record<string, unknown> }): string | Promise<string>;
	toPlainText(html: string): string;
};

let emailRendererPromise: Promise<EmailRenderer> | undefined;

function getEmailRenderer(): Promise<EmailRenderer> {
	emailRendererPromise ??= import('@better-svelte-email/server').then(({ Renderer, toPlainText }) => {
		const renderer = new Renderer({ customCSS: appStyles });
		return {
			render: (component, options) => renderer.render(component, options),
			toPlainText
		};
	});
	return emailRendererPromise;
}

type SendRenderedEmailParams = {
	component: unknown;
	props?: Record<string, unknown>;
	subject: string;
	to: string;
};

type CloudflareEmailResponse = {
	success?: boolean;
	errors?: { code?: number; message?: string }[];
	messages?: { code?: number; message?: string }[];
	result?: {
		delivered?: string[];
		permanent_bounces?: string[];
		queued?: string[];
	};
};

type CloudflareAccountsResponse = CloudflareEmailResponse & {
	result?: { id: string; name?: string }[];
};

let cachedCloudflareAccountId: string | null = null;

async function getCloudflareAccountId(apiToken: string) {
	if (cachedCloudflareAccountId) return cachedCloudflareAccountId;

	const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=2', {
		headers: { Authorization: `Bearer ${apiToken}` }
	});

	let body: CloudflareAccountsResponse | string;
	try {
		body = (await response.json()) as CloudflareAccountsResponse;
	} catch {
		body = await response.text();
	}

	if (!response.ok) {
		const details =
			typeof body === 'string'
				? body
				: [...(body.errors ?? []), ...(body.messages ?? [])]
						.map((entry) => entry.message ?? entry.code)
						.filter(Boolean)
						.join(', ');
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

	let body: CloudflareEmailResponse | string;
	try {
		body = (await response.json()) as CloudflareEmailResponse;
	} catch {
		body = await response.text();
	}

	if (response.ok) {
		console.info('[Email sent with Cloudflare REST API]', {
			to,
			subject,
			response: body
		});
		return;
	}

	const details =
		typeof body === 'string'
			? body
			: [...(body.errors ?? []), ...(body.messages ?? [])]
					.map((entry) => entry.message ?? entry.code)
					.filter(Boolean)
					.join(', ');
	throw new Error(
		`Cloudflare Email REST send failed (${response.status}${details ? `: ${details}` : ''})`
	);
}

export async function sendRenderedEmail({
	component,
	props,
	subject,
	to
}: SendRenderedEmailParams) {
	const env = getRuntimeEnv();

	const { render, toPlainText } = await getEmailRenderer();
	const html = await instrument('email.render', () => render(component, { props }));
	const text = toPlainText(html);
	const fromAddress = env.EMAIL_FROM_ADDRESS;
	const fromName = env.EMAIL_FROM_NAME;
	const replyTo = env.EMAIL_REPLY_TO;

	if (env.EMAIL) {
		await instrument(
			'email.send',
			() =>
				env.EMAIL!.send({
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

	if (!dev) {
		throw new Error(
			'No email provider is configured. Configure the EMAIL binding or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN.'
		);
	}

	console.info(
		`[Email skipped: EMAIL binding is unavailable in Vite dev and REST fallback is not configured.]\nTo: ${to}\nSubject: ${subject}\n\n${text}`
	);
}
