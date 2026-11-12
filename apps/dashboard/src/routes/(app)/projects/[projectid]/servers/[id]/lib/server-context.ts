import { getContext, setContext } from 'svelte';
import type { ServerInfo } from '#lib/server-info.js';

const serverContextKey = Symbol('server');

interface ServerContext {
	readonly current: ServerInfo;
}

export function provideServer(read: () => ServerInfo): void {
	setContext<ServerContext>(serverContextKey, {
		get current() {
			return read();
		}
	});
}

export function useServer(): ServerContext {
	return getContext<ServerContext>(serverContextKey);
}
