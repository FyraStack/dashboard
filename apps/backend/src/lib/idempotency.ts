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
