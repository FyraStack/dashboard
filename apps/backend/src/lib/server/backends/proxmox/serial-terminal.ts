import type { ProxmoxClient } from './client.ts';

const SERIAL_PORT = 'serial0';
const ACCEPTANCE_TIMEOUT_MS = 15_000;
const ACCEPTED_PREFIX = [0x4f, 0x4b];

const encoder = new TextEncoder();

export interface SerialTerminal {
	greeting: Uint8Array;
	socket: WebSocket;
}

export const termProxyPing = '2';

export function termProxyInput(data: string) {
	return `0:${encoder.encode(data).length}:${data}`;
}

export function termProxyResize(cols: number, rows: number) {
	return `1:${cols}:${rows}:`;
}

export function toBytes(data: string | ArrayBuffer): Uint8Array {
	return typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
}

function concatBytes(head: Uint8Array, tail: Uint8Array) {
	const joined = new Uint8Array(head.length + tail.length);
	joined.set(head);
	joined.set(tail, head.length);
	return joined;
}

function matchesAcceptedPrefix(bytes: Uint8Array) {
	return bytes
		.subarray(0, ACCEPTED_PREFIX.length)
		.every((byte, index) => byte === ACCEPTED_PREFIX[index]);
}

function awaitAcceptance(socket: WebSocket): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		let received = new Uint8Array(0);
		const settle = (outcome: () => void) => {
			clearTimeout(timeout);
			socket.removeEventListener('message', onMessage);
			socket.removeEventListener('close', onClose);
			socket.removeEventListener('error', onClose);
			outcome();
		};
		const onMessage = (event: MessageEvent) => {
			received = concatBytes(received, toBytes(event.data));
			if (!matchesAcceptedPrefix(received)) {
				settle(() => reject(new Error('Proxmox rejected the console ticket')));
			} else if (received.length >= ACCEPTED_PREFIX.length) {
				settle(() => resolve(received.subarray(ACCEPTED_PREFIX.length)));
			}
		};
		const onClose = () =>
			settle(() => reject(new Error('Serial console closed during authentication')));
		const timeout = setTimeout(
			() => settle(() => reject(new Error('Timed out waiting for the serial console'))),
			ACCEPTANCE_TIMEOUT_MS
		);

		socket.addEventListener('message', onMessage);
		socket.addEventListener('close', onClose);
		socket.addEventListener('error', onClose);
	});
}

export async function connectSerialTerminal(
	client: ProxmoxClient,
	node: string,
	vmid: number
): Promise<SerialTerminal> {
	const ticket = await client.createTermProxy(node, vmid, SERIAL_PORT);
	const socket = await client.openVncWebSocket(node, vmid, ticket);
	socket.send(`${ticket.user}:${ticket.ticket}\n`);

	try {
		return { socket, greeting: await awaitAcceptance(socket) };
	} catch (cause) {
		socket.close(1011, 'Serial console authentication failed');
		throw cause;
	}
}
