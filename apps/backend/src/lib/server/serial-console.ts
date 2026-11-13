import { env } from 'cloudflare:workers';
import { decodeHttpError, type HttpErrorPayload } from 'stack-shared/http-error';
import { serialConsoleBasePath } from 'stack-shared/routes';
import { requireUser } from '#lib/server/auth-context.js';
import { proxmox } from '#lib/server/backends/index.js';
import { getFeatureFlags } from '#lib/server/feature-flags.js';
import { error } from '#lib/server/http.js';
import { inScope } from '#lib/server/scope.js';
import {
	type SerialConsoleTarget,
	serialConsoleSessionRequest
} from '#lib/server/serial-console-session.js';
import { assertPowerable, requireAccessibleVm } from '#lib/server/vm-access.js';

const REJECTION_CLOSE_CODE_BASE = 4000;

async function authorizeSerialConsole(vmId: string): Promise<SerialConsoleTarget> {
	const { db, user } = requireUser();
	const flags = await getFeatureFlags();
	if (!flags.vpsConsole) {
		error(404, 'The serial console is not available');
	}

	const row = await requireAccessibleVm(db, user, vmId, 'read_write');
	assertPowerable(row);

	const live = await proxmox().getVm(row.id, row.proxmoxId ?? undefined, {
		proxmoxNode: row.proxmoxNode ?? undefined
	});
	if (live.status !== 'running') {
		error(409, 'Start the server to use the serial console');
	}
	if (!live.proxmoxNode || live.proxmoxId === undefined) {
		error(503, 'The serial console is unavailable for this server');
	}

	return { node: live.proxmoxNode, vmid: live.proxmoxId };
}

function rejectWithStatus({ status, message }: HttpErrorPayload) {
	const { 0: client, 1: server } = new WebSocketPair();
	server.accept();
	server.send(JSON.stringify({ type: 'status', state: 'closed', message }));
	server.close(REJECTION_CLOSE_CODE_BASE + status, message.slice(0, 120));
	return new Response(null, { status: 101, webSocket: client });
}

function vmIdFromPath(pathname: string) {
	const encoded = pathname.slice(serialConsoleBasePath.length + 1);
	if (!encoded || encoded.includes('/')) {
		return null;
	}
	try {
		return decodeURIComponent(encoded);
	} catch {
		return null;
	}
}

export async function connectSerialConsole(request: Request) {
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return new Response('Expected a WebSocket upgrade', { status: 426 });
	}
	if (request.headers.get('origin') !== new URL(env.ORIGIN).origin) {
		return new Response('Forbidden', { status: 403 });
	}

	const vmId = vmIdFromPath(new URL(request.url).pathname);
	if (!vmId) {
		return new Response('Not found', { status: 404 });
	}

	let target: SerialConsoleTarget;
	try {
		target = await inScope({ headers: request.headers, url: request.url }, () =>
			authorizeSerialConsole(vmId)
		);
	} catch (cause) {
		return rejectWithStatus(
			decodeHttpError(cause) ?? { status: 500, message: 'The serial console is unavailable' }
		);
	}

	const session = env.SERIAL_CONSOLE.get(env.SERIAL_CONSOLE.idFromName(vmId));
	return session.fetch(serialConsoleSessionRequest(request, target));
}
