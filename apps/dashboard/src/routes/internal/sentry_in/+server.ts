import { error, type RequestHandler } from '@sveltejs/kit';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

function allowedProject(): { host: string; projectId: string } | null {
	const dsn = PUBLIC_SENTRY_DSN;
	if (!dsn) return null;
	const url = new URL(dsn);
	return { host: url.hostname, projectId: url.pathname.replace(/^\//, '') };
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const allowed = allowedProject();
	if (!allowed) throw error(404, 'Sentry is not configured');

	const envelope = await request.arrayBuffer();
	const headerLine = new TextDecoder().decode(envelope).split('\n')[0];

	let dsn: URL;
	try {
		dsn = new URL(JSON.parse(headerLine).dsn);
	} catch {
		throw error(400, 'Invalid Sentry envelope');
	}

	const projectId = dsn.pathname.replace(/^\//, '');
	if (dsn.hostname !== allowed.host || projectId !== allowed.projectId) {
		throw error(403, 'Envelope does not match the configured Sentry project');
	}

	const upstream = await fetch(`https://${allowed.host}/api/${projectId}/envelope/`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-sentry-envelope' },
		body: envelope
	});

	if (!upstream.ok) {
		throw error(502, `Sentry rejected the envelope (${upstream.status})`);
	}

	return Response.json({});
};
