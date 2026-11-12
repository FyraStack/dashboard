import { requestFingerprint } from 'stack-shared/request-fingerprint';
import { ulid } from 'ulid';
import { page } from '$app/state';

type IdempotentCommand<I extends { idempotencyKey: string }, O> = (input: I) => Promise<O>;

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
