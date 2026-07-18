import { ulid } from '$lib/server/id';

export type AgentCommand = {
	id: string;
	module: string;
	action: string;
	payload: Record<string, unknown>;
	signature?: string | null;
};

export type AgentResponse = {
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: string;
};

export type TetraClient = {
	health(): Promise<{ ok: boolean }>;
	capabilities(): Promise<AgentResponse>;
	dispatch(command: Omit<AgentCommand, 'id'> & { id?: string }): Promise<AgentResponse>;
};

export class DirectHttpTetraClient implements TetraClient {
	readonly #baseUrl: string;
	readonly #bearerToken: string | null;

	constructor(baseUrl: string, bearerToken?: string | null) {
		this.#baseUrl = baseUrl.replace(/\/+$/, '');
		this.#bearerToken = bearerToken?.trim() || null;
	}

	async health() {
		return this.#request<{ ok: boolean }>('/health');
	}

	async capabilities() {
		return this.#request<AgentResponse>('/capabilities');
	}

	async dispatch(command: Omit<AgentCommand, 'id'> & { id?: string }) {
		return this.#request<AgentResponse>('/dispatch', {
			method: 'POST',
			body: JSON.stringify({
				id: command.id ?? `cmd-${ulid()}`,
				module: command.module,
				action: command.action,
				payload: command.payload,
				signature: command.signature ?? null
			})
		});
	}

	async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		headers.set('accept', 'application/json');

		if (init.body && !headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}

		if (this.#bearerToken) {
			headers.set('authorization', `Bearer ${this.#bearerToken}`);
		}

		const response = await fetch(`${this.#baseUrl}${path}`, {
			...init,
			headers
		});
		const text = await response.text();
		const data = text ? JSON.parse(text) : null;

		if (!response.ok) {
			const message =
				(data && typeof data === 'object' && 'error' in data ? String(data.error) : '') ||
				`Tetra request failed with HTTP ${response.status}`;
			throw new Error(message);
		}

		return data as T;
	}
}

export function createTetraClient(options: {
	connectionMode: string;
	agentUrl: string | null;
	bearerToken: string | null;
}): TetraClient {
	if (options.connectionMode !== 'direct_http') {
		throw new Error(`Tetra connection mode ${options.connectionMode} is not implemented yet`);
	}

	if (!options.agentUrl) {
		throw new Error('Direct HTTP Tetra hosts require an agent URL');
	}

	return new DirectHttpTetraClient(options.agentUrl, options.bearerToken);
}
