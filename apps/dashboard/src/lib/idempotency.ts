import { ulid } from 'ulid';

export type RequestDetails = Record<
	string,
	string | number | boolean | null | undefined | readonly string[]
>;

export async function requestFingerprint(operation: string, details: RequestDetails) {
	const entries = Object.entries(details)
		.filter(([, value]) => value !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	const bytes = new TextEncoder().encode(JSON.stringify([operation, entries]));
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareIdempotentRequest(operation: string, details: RequestDetails) {
	const storageKey = `request:${await requestFingerprint(operation, details)}`;
	const key = sessionStorage.getItem(storageKey) ?? ulid();
	sessionStorage.setItem(storageKey, key);
	return {
		key,
		complete() {
			if (sessionStorage.getItem(storageKey) === key) {
				sessionStorage.removeItem(storageKey);
			}
		}
	};
}
