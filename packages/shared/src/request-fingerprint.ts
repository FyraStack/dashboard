import { sha256Hex } from './hash.ts';

export type RequestDetails = Record<
	string,
	string | number | boolean | null | undefined | readonly string[]
>;

export function requestFingerprint(operation: string, details: RequestDetails) {
	const entries = Object.entries(details)
		.filter(([, value]) => value !== undefined)
		.sort(([a], [b]) => a.localeCompare(b));
	return sha256Hex(JSON.stringify([operation, entries]));
}
