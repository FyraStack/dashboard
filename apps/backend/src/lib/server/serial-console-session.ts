import { DurableObject } from 'cloudflare:workers';
import { proxmox } from '#lib/server/backends/index.js';
import {
	termProxyInput,
	termProxyPing,
	termProxyResize,
	toBytes
} from '#lib/server/backends/proxmox/serial-terminal.js';

export interface SerialConsoleTarget {
	node: string;
	vmid: number;
}

type SessionState = 'connecting' | 'connected' | 'closed';

type ClientMessage =
	| { type: 'claim' }
	| { type: 'input'; data: string }
	| { type: 'resize'; cols: number; rows: number };

const UPSTREAM_PING_INTERVAL_MS = 30_000;
const IDLE_GRACE_MS = 5 * 60_000;
const REPLAY_BUFFER_BYTES = 64 * 1024;
const TARGET_NODE_PARAM = 'node';
const TARGET_VMID_PARAM = 'vmid';
const MAX_CLOSE_REASON_LENGTH = 120;

export function serialConsoleSessionRequest(request: Request, target: SerialConsoleTarget) {
	const url = new URL('https://serial-console/connect');
	url.searchParams.set(TARGET_NODE_PARAM, target.node);
	url.searchParams.set(TARGET_VMID_PARAM, String(target.vmid));
	return new Request(url, request);
}

function readTarget(request: Request): SerialConsoleTarget | null {
	const { searchParams } = new URL(request.url);
	const node = searchParams.get(TARGET_NODE_PARAM);
	const vmid = Number(searchParams.get(TARGET_VMID_PARAM));
	return node && Number.isInteger(vmid) ? { node, vmid } : null;
}

function parseClientMessage(message: string): ClientMessage | null {
	try {
		const parsed: unknown = JSON.parse(message);
		if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
			return null;
		}
		if (parsed.type === 'claim') {
			return { type: 'claim' };
		}
		if (parsed.type === 'input' && 'data' in parsed && typeof parsed.data === 'string') {
			return { type: 'input', data: parsed.data };
		}
		if (
			parsed.type === 'resize' &&
			'cols' in parsed &&
			'rows' in parsed &&
			Number.isInteger(parsed.cols) &&
			Number.isInteger(parsed.rows)
		) {
			return { type: 'resize', cols: Number(parsed.cols), rows: Number(parsed.rows) };
		}
	} catch {
		return null;
	}
	return null;
}

function trySend(socket: WebSocket, payload: string | ArrayBuffer) {
	if (socket.readyState === WebSocket.OPEN) {
		socket.send(payload);
	}
}

function tryClose(socket: WebSocket, reason?: string) {
	if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
		socket.close(1000, reason?.slice(0, MAX_CLOSE_REASON_LENGTH));
	}
}

class ReplayBuffer {
	private chunks: Uint8Array[] = [];
	private size = 0;
	private readonly capacity: number;

	constructor(capacity: number) {
		this.capacity = capacity;
	}

	append(bytes: Uint8Array) {
		this.chunks.push(bytes.slice());
		this.size += bytes.length;
		while (this.size > this.capacity && this.chunks.length > 1) {
			this.size -= this.chunks.shift()?.length ?? 0;
		}
	}

	snapshot(): ArrayBuffer | null {
		if (this.size === 0) {
			return null;
		}
		const out = new Uint8Array(this.size);
		let offset = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out.buffer;
	}

	clear() {
		this.chunks = [];
		this.size = 0;
	}
}

export class SerialConsoleDurableObject extends DurableObject<Env> {
	private upstream: WebSocket | null = null;
	private state: SessionState = 'closed';
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private lastSize: { cols: number; rows: number } | null = null;
	private writer: WebSocket | null = null;
	private readonly replay = new ReplayBuffer(REPLAY_BUFFER_BYTES);

	async fetch(request: Request) {
		const target = readTarget(request);
		if (!target) {
			return new Response('Missing console target', { status: 400 });
		}

		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		await this.ctx.storage.deleteAlarm();

		if (this.state === 'connected') {
			this.sendStatus(server, 'connected');
			this.sendReplay(server);
		} else {
			this.sendStatus(server, 'connecting');
			if (this.state === 'closed') {
				this.openUpstream(target);
			}
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
		if (typeof message !== 'string') {
			return;
		}

		const parsed = parseClientMessage(message);
		if (!parsed) {
			return;
		}
		if (parsed.type === 'claim') {
			this.writer = socket;
			return;
		}
		if (parsed.type === 'input') {
			this.writer ??= socket;
		}
		if (this.writer !== socket) {
			return;
		}
		if (parsed.type === 'input') {
			this.sendUpstream(termProxyInput(parsed.data));
		} else {
			this.lastSize = { cols: parsed.cols, rows: parsed.rows };
			this.sendUpstream(termProxyResize(parsed.cols, parsed.rows));
		}
	}

	async webSocketClose(socket: WebSocket) {
		await this.dropClient(socket);
	}

	async webSocketError(socket: WebSocket) {
		await this.dropClient(socket);
	}

	alarm() {
		if (this.clients().length === 0) {
			this.closeUpstream('No clients attached');
		}
	}

	private clients() {
		return this.ctx.getWebSockets();
	}

	private async dropClient(socket: WebSocket) {
		tryClose(socket);
		if (this.writer === socket) {
			this.writer = null;
		}
		const remaining = this.clients().filter((client) => client !== socket);
		if (remaining.length === 0) {
			await this.ctx.storage.setAlarm(Date.now() + IDLE_GRACE_MS);
		}
	}

	private openUpstream(target: SerialConsoleTarget) {
		this.state = 'connecting';
		proxmox()
			.openSerialTerminal(target.node, target.vmid)
			.then(
				({ socket, greeting }) => this.attachUpstream(socket, greeting),
				(cause: unknown) => {
					console.warn(`Serial console for VM ${target.vmid} on ${target.node} failed`, cause);
					this.closeUpstream(
						cause instanceof Error ? cause.message : 'Serial console connection failed'
					);
				}
			);
	}

	private attachUpstream(upstream: WebSocket, greeting: Uint8Array) {
		this.upstream = upstream;
		this.state = 'connected';
		upstream.addEventListener('message', (event) => {
			if (this.upstream === upstream) {
				this.broadcast(toBytes(event.data));
			}
		});
		upstream.addEventListener('close', (event) => {
			if (this.upstream === upstream) {
				this.closeUpstream(event.reason || 'Serial console disconnected');
			}
		});
		upstream.addEventListener('error', () => {
			if (this.upstream === upstream) {
				this.closeUpstream('Serial console error');
			}
		});

		if (this.lastSize) {
			this.sendUpstream(termProxyResize(this.lastSize.cols, this.lastSize.rows));
		}
		this.pingTimer = setInterval(() => this.sendUpstream(termProxyPing), UPSTREAM_PING_INTERVAL_MS);
		for (const client of this.clients()) {
			this.sendStatus(client, 'connected');
		}
		if (greeting.length > 0) {
			this.broadcast(greeting);
		}
	}

	private sendUpstream(payload: string) {
		if (this.state !== 'connected' || !this.upstream) {
			return;
		}
		try {
			this.upstream.send(payload);
		} catch {
			this.closeUpstream('Serial console disconnected');
		}
	}

	private broadcast(bytes: Uint8Array) {
		this.replay.append(bytes);
		const { buffer } = bytes.slice();
		for (const client of this.clients()) {
			trySend(client, buffer);
		}
	}

	private sendReplay(client: WebSocket) {
		const buffer = this.replay.snapshot();
		if (buffer) {
			trySend(client, buffer);
		}
	}

	private sendStatus(client: WebSocket, state: SessionState, message?: string) {
		trySend(client, JSON.stringify({ type: 'status', state, message }));
	}

	private closeUpstream(reason: string) {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
		const { upstream } = this;
		this.upstream = null;
		this.state = 'closed';
		this.replay.clear();
		if (upstream) {
			tryClose(upstream, reason);
		}
		for (const client of this.clients()) {
			this.sendStatus(client, 'closed', reason);
			tryClose(client, reason);
		}
	}
}
