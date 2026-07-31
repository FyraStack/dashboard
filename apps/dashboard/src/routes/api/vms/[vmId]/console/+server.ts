import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { WebSocket as PveWebSocket } from '@cloudflare/workers-types';
import type { RequestHandler } from './$types';
import { initDrizzle } from '$lib/server/db';
import { vms } from '$lib/server/db/schema';
import { getBackend } from '$lib/server/backends';
import { requireProjectAccess } from '$lib/server/auth-context';

// Provided by the Cloudflare Workers runtime; not present in @sveltejs/kit's ambient DOM types.
declare const WebSocketPair: new () => { 0: PveWebSocket; 1: PveWebSocket };

function decodeBrowserMessage(data: unknown): string {
	if (typeof data === 'string') return data;
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as Uint8Array);
	return String(data);
}

export const GET: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Authentication required');
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		error(426, 'Expected websocket upgrade');
	}

	const db = initDrizzle();
	const row = await db.query.vms.findFirst({ where: eq(vms.id, params.vmId) });
	if (!row) error(404, `VM "${params.vmId}" not found`);
	if (row.status === 'deleting') error(409, `VM "${row.name}" is being deleted`);
	if (row.ownerProjectId) {
		await requireProjectAccess(db, locals.user.id, row.ownerProjectId, 'read_write');
	}

	const backend = getBackend(row.backend);
	if (!backend.openConsole) {
		error(501, `Backend "${row.backend}" does not support console access`);
	}

	const { socket: upstream, sendInput, initialData } = await backend.openConsole(
		row.id,
		row.proxmoxId ?? undefined,
		{ proxmoxNode: row.proxmoxNode ?? undefined }
	);

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair);
	server.accept();

	if (initialData) {
		try {
			server.send(initialData);
		} catch {
			// browser socket already closed
		}
	}

	server.addEventListener('message', (event) => {
		try {
			sendInput(decodeBrowserMessage(event.data));
		} catch {
			// upstream socket already closed
		}
	});
	server.addEventListener('close', (event) => {
		try {
			upstream.close(event.code, event.reason);
		} catch {
			// upstream socket already closed
		}
	});
	server.addEventListener('error', () => {
		try {
			upstream.close(1011, 'Client console error');
		} catch {
			// upstream socket already closed
		}
	});

	upstream.addEventListener('message', (event) => {
		try {
			server.send(event.data);
		} catch {
			// browser socket already closed
		}
	});
	upstream.addEventListener('close', (event) => {
		try {
			server.close(event.code, event.reason);
		} catch {
			// browser socket already closed
		}
	});
	upstream.addEventListener('error', () => {
		try {
			server.close(1011, 'Upstream console error');
		} catch {
			// browser socket already closed
		}
	});

	const init: ResponseInit & { webSocket: PveWebSocket } = { status: 101, webSocket: client };
	return new Response(null, init);
};
