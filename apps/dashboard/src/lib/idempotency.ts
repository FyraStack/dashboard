import { ulid } from 'ulid';
import { page } from '$app/state';

export type RequestDetails = Record<
	string,
	string | number | boolean | null | undefined | readonly string[]
>;

type IdempotentCommand<I extends { idempotencyKey: string }, O> = (input: I) => Promise<O>;

export async function requestFingerprint(operation: string, details: RequestDetails) {
	const entries = Object.entries(details)
		.filter(([, value]) => value !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	const bytes = new TextEncoder().encode(JSON.stringify([operation, entries]));
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function idempotencyScope() {
	const claimed = new Map<string, string>();
	return {
		async run<I extends { idempotencyKey: string }, O>(
			command: IdempotentCommand<I, O>,
			operation: string,
			input: Omit<I, 'idempotencyKey'>
		) {
			const storageKey = `request:${await requestFingerprint(operation, {
				input: JSON.stringify(input),
				userId: page.data.user?.id
			})}`;
			const key = sessionStorage.getItem(storageKey) ?? ulid();
			sessionStorage.setItem(storageKey, key);
			claimed.set(storageKey, key);
			return command({ ...input, idempotencyKey: key } as I);
		},
		complete() {
			for (const [storageKey, key] of claimed) {
				if (sessionStorage.getItem(storageKey) === key) {
					sessionStorage.removeItem(storageKey);
				}
			}
			claimed.clear();
		}
	};
}

export async function idempotent<I extends { idempotencyKey: string }, O>(
	command: IdempotentCommand<I, O>,
	operation: string,
	input: Omit<I, 'idempotencyKey'>
) {
	const scope = idempotencyScope();
	const result = await scope.run(command, operation, input);
	scope.complete();
	return result;
}
