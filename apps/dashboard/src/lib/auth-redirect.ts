import { goto } from '$app/navigation';

export function authHref(path: string, redirectTo: string, params: Record<string, string> = {}) {
	const search = new URLSearchParams(params);
	if (redirectTo !== '/') {
		search.set('redirectTo', redirectTo);
	}
	const query = search.toString();
	return query ? `${path}?${query}` : path;
}

export async function goAfterAuth(redirectTo: string) {
	await goto(redirectTo).catch(() => goto('/'));
}
